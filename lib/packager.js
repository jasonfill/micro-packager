var os = require('os');
var detective = require('detective');
var fs = require('fs-extra');
var wrench = require('wrench');
var fss = require('fs');
var async = require('async');
var path = require('path');
var archiver = require('archiver');
var aws = require('aws-sdk');
var uuid = require('node-uuid');
var string = require('string');

/**
 * Builds a new npm package.
 *
 * @async
 * @method build
 * @param {Object} opts Object that holds all the build data.
 * @param {String} opts.function_name The name of the function
 * @param {String} opts.app_root The root path to the application.
 * @param {String} opts.root_file The root file that will start the spidering for dependencies.  Relative from app_root, starting with /.
 * @param {Object} opts.required_modules The modules that are required regardless. {'crypto-js': '*', 'mandrill-api': '*', 'buffertools': '*'}
 * @param {String} opts.package_name The name of the new package.
 * @param {String} opts.execution_file This will be the main file that will be executed by lambda.  Relative from app_root, starting with /.
 * @param {Array}  opts.additional_files An array of the relative file path from the root to include. Relative from app_root, starting with /.
 * @param {Function} callback A function for the callback accepting the following argument 'err, Result'.
 * @example
 *    function(err, Result){}
 */

var build = function(opts, callback){
    var local = {process : true};
    var timestamp = Math.floor(Date.now() / 1000);

    var build_id = timestamp + '_' + string(opts.package_name).slugify().s + '_' + uuid.v4().replace(/-/g,'');
    var package_file = fs.readFileSync(opts.app_root + '/package.json');
    // handle some defaults.
    if(opts.clear_output_dir === undefined){
        opts.clear_output_dir = true;
    }
    if(!opts.temp_dir) {
        opts.temp_dir = os.tmpdir();
    }

    if(opts.delete_temp_dir === undefined) {
        opts.delete_temp_dir = true;
    }

    if(opts.include_node_modules === undefined) {
        opts.include_node_modules = true;
    }

    local.temp_dir = opts.temp_dir + build_id;
    local.output_zip_dir = opts.output_dir;

    console.log('Starting build process for function - ' + opts.package_name);
    console.log('Build Id: ' + build_id);
    console.log('Writing files to: ' + local.temp_dir);

    async.series([
            function(callback){
                // if we need to continue to process, lets go...
                if(local.process) {
                    local.output_zip_name = build_id + ".zip";

                    local.full_zip_path = local.output_zip_dir + "/" + local.output_zip_name;

                    local.required_modules = opts.required_modules;
                    local.bundledDependencies = [];
                    local.required_libs = {};
                    local.files_parsed = {};
                    local.invalid_files = {}


                    //remove the output dir, just to make sure things are all clean...
                    if(opts.clear_output_dir){
                        fs.removeSync(local.output_zip_dir);
                    }

                    fs.ensureDirSync(local.temp_dir, function (err) {
                        if (err)
                            console.error(err)
                    });

                    fs.ensureDirSync(local.output_zip_dir, function (err) {
                        if (err)
                            console.error(err)
                    });

                    getDepends = function (filepath, subdir) {


                        if (fs.existsSync(filepath)) {


                            var src = fs.readFileSync(filepath);
                            var requires = detective(src);

                            local.files_parsed[filepath] = true;

                            //console.log(filepath);
                            //console.log(requires)

                            for (var r = 0; r < requires.length; r++) {
                                var file = requires[r];
                                if (file.substring(0, 1) === '.') {
                                    if (path.extname(file) !== '.js') {
                                        var full_path = path.resolve(opts.app_root + '/' + subdir + '/', file) + '.js';
                                    } else {
                                        var full_path = path.resolve(opts.app_root + '/' + subdir + '/', file);
                                    }

                                    //console.log(full_path);

                                    if (fs.existsSync(full_path)) {
                                        local.required_libs[full_path] = true;
                                    }

                                    if (!local.files_parsed[full_path]) {
                                        this.getDepends(full_path, subdir);
                                    }

                                } else {
                                    local.required_modules[file] = '*';
                                }
                            }
                        } else {
                            local.invalid_files[filepath] = true;
                        }
                        return;
                    }

                    getDepends(opts.app_root + opts.root_file, 'lib');
                    local.required_libs[opts.app_root + opts.root_file] = true;

                    // now, lets copy the required libs to the dist dir...
                    for (var lib in local.required_libs) {

                        var output_location = lib.replace(opts.app_root, local.temp_dir);

                        //console.log(lib + "--->" + output_location)


                        fs.ensureDirSync(path.dirname(output_location), function (err) {
                            if (err)
                                console.error(err)
                            //console.log("success!")
                        });

                        fs.writeFileSync(output_location, fs.readFileSync(lib));

                    }

                    // now, lets copy the required node_modules...
                    if(opts.include_node_modules){
                        for (var module in local.required_modules) {

                            var source_location = opts.app_root + '/node_modules/' + module;
                            var output_location = local.temp_dir + '/node_modules/' + module;

                            //console.log(source_location + "--->" + output_location)

                            if (fs.existsSync(source_location)) {
                                fs.ensureDirSync(path.dirname(output_location), function (err) {
                                    if (err)
                                        console.error(err)
                                    //console.log("success!")
                                });

                                wrench.copyDirSyncRecursive(source_location, output_location, {
                                    forceDelete: true,
                                    preserveFiles: false,
                                    preserveTimestamps: true,
                                    inflateSymlinks: false
                                });

                                local.bundledDependencies.push(module);
                            }

                        }
                    }

                    // lastly, overwrite the config.js file..

                    var region_config = require(opts.app_root + '/config.js');
                    region_config = JSON.stringify(region_config, null, '\t')
                    //console.log(region_config)

                    //var config_file = "var cfg = require('./config/config.production.us-east-1.js');\n\n";

                    var config_file = "module.exports = " + region_config + ";";

                    fs.writeFileSync(local.temp_dir + '/config.js', config_file);


                    // now generate the package.json file...
                    var micro_package = {
                        name: opts.package_name,
                        version: package_file.version,
                        private: true,
                        dependencies: local.required_modules,
                        bundledDependencies: local.bundledDependencies
                    };
                    var root_package = fs.readFileSync(opts.app_root + '/package.json');

                    root_package = JSON.parse(root_package);

                    for (var d in micro_package.dependencies) {
                        //  console.log(root_package.dependencies[d]);
                        micro_package.dependencies[d] = root_package.dependencies[d];
                    }

                    console.log("Writing new package file...");
                    fs.writeJsonSync(local.temp_dir + '/package.json', micro_package);

                    console.log("Writing Main Lib File...");
                    // lastly copy the main file..
                    fs.writeFileSync(local.temp_dir + '/index.js', fs.readFileSync(opts.app_root + opts.execution_file));

                    console.log('Copying additional files now...');
                    // copy any additional files now..
                    for(var f = 0; f < opts.additional_files.length; f++){
                        // make sure the directory path is all created before attempting to copy file.
                        fs.ensureDirSync(path.dirname(opts.temp_dir + opts.additional_files[f]), function (err) {
                            if (err)
                                console.error(err)
                            //console.log("success!")
                            fs.writeFileSync(local.temp_dir + opts.additional_files[f], fs.readFileSync(opts.app_root + opts.additional_files[f]));
                        });
                    }

                    console.log('Remove any directories that are not needed...');
                    // kill any directories that are not needed.
                    for(var d = 0; d < opts.remove_directories.length; d++){
                        fs.removeSync(local.temp_dir + opts.remove_directories[d]);
                    }
                    // create the zip file now...

                    console.log("Creating zip file now.");


                    var output = fs.createWriteStream(local.full_zip_path);
                    var archive = archiver('zip');

                    output.on('close', function () {
                        console.log(archive.pointer() + ' total bytes');
                        console.log('archiver has been finalized and the output file descriptor has closed.');


                        // lastly clean up the temp dir...
                        if(opts.delete_temp_dir){
                            fs.removeSync(local.temp_dir);
                        }

                        callback(null);
                    });

                    archive.on('error', function (err) {
                        console.log(err);
                        callback(err);
                        throw err;
                    });

                    archive.pipe(output);


                    archive.bulk([
                        {expand: true, cwd: local.temp_dir, src: ['**']}
                    ]);

                    archive.finalize();

                }else{
                    callback(null);
                }
            }
        ],
        // optional callback
        function(err, results){
            if(!err){
                // now lets clean up the dist dir.
                //fs.removeSync(local.temp_dir);
                callback(null, local);
            }else{
                throw new Error(err);
            }
        });
};

/**
 * Deploys a lambda package.
 *
 * @async
 * @method deploy
 * @param {Object} opts Object that holds all the build data.
 * @param {String} opts.zip_file The full path of the zip file to deploy.
 * @param {String} opts.handler The handler of the function that will be passed to Lambda.
 * @param {String} opts.role The ARN role that will be granted to process this.
 * @param {Array}  opts.functions An array that contains all the different function configs to upload.
 * @param {Object}  opts.aws The aws config object.
 * @param {Function} callback A function for the callback accepting the following argument 'err, Result'.
 * @example
 *    function(err, Result){}
 */

var deploy = function(opts, callback){
    var lambda = new aws.Lambda(opts.aws);
    console.log('Starting deploy process');
    console.log(opts.aws);
    async.each(opts.functions, function(func, callback) {

        // Perform operation on file here.
        console.log('Processing function ' + func.name);

        var params = {
            FunctionName: func.name,
            FunctionZip: fs.readFileSync(opts.zip_file),
            Handler: opts.handler,
            Mode: 'event',
            Role: opts.role,
            Runtime: 'nodejs',
            Description: func.description,
            MemorySize: func.memory,
            Timeout: func.timeout
        };
        console.log('Uploading function ' + func.name);
        lambda.uploadFunction(params, function (err, data) {
            console.log(arguments);
            if (err){
                callback(err);
            } else{
                callback(null, data);
            }
        });
    }, function(err, results){
        // if any of the file processing produced an error, err would equal that error
        if( err ) {
            // One of the iterations produced an error.
            // All processing will now stop.
            console.log('A file failed to process');
        } else {
            console.log('All files have been processed successfully');
        }
        return callback(err, results);
    });
};



module.exports = {
    build : build,
    deploy : deploy
}