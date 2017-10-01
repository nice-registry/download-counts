exports.filenameToPackageName = function filenameToPackageName (filename) {  
  return filename
    .replace('___', '/') // scoped packages
    .replace('.json', '') // remove file extension
}

exports.packageNameToFilename = function packageNameToFilename (name) {  
  return name
    .replace('/', '___') // scoped packages
    .replace(/$/, '.json') // add file extension
}

