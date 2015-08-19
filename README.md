# Micro Packager
Library to extract part of an npm package and create a new smaller npm package that contains only the component peices required.  Just point the packager to the main root file and the application will be spidered and pull in all required dependencies.

In addition to extracting the smaller application, there is also the option to deploy to AWS Lambda to run the smaller application as a function.

> NOTE: This is a very rough first pass at the application.  The actual process can be cleaned up but at the moment just trying to work on a PoC.

## Usage

```
var packager = require('micro-packager');

// put all the options together...
var opts = {
    package_name: '',
    app_root: '',
    output_dir : '',
    root_file: '',
    execution_file: '',
    additional_files : [],
    required_modules: {},
    delete_temp_dir: false,
    remove_directories : [],
    include_node_modules : true
};

// Build the package...
packager.build(opts, function(err, results){
    console.log(arguments);
});
```

## Options

* ```package_name``` : The name that should be assigned to the new package.
* ```app_root``` : The absolute path to the root of the parent/source application.
* ```output_dir``` : The directory the zip file should be written to.
* ```root_file``` : The file that should be used to start the spidering to get all the component pieces.
* ```execution_file``` : The file that holds the code that will serve as the execution file in the new application.
* ```additional_files``` : An array of any additional files that need to be included in the new application.
* ```required_modules``` : An array of any additional npm modules that need to be included in the new application.
* ```delete_temp_dir``` : If the temporary directory should be removed after creation.  Default true.
* ```remove_directories``` : An array of directories that should be removed to decrease the size of the application.  In some cases npm modules have a build directory that can be removed after the npm install has run.
* ```include_node_modules``` : If the node_modules directory should be included.




