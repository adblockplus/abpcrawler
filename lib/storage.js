Cu.import("resource://gre/modules/FileUtils.jsm");

function createTemporaryFile(name)
{
  let file = FileUtils.getFile("TmpD", [name]);
  file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE,
                    FileUtils.PERMS_FILE);
  return file;
}

function openOutputStream(file)
{
  let outputStream = Cc["@mozilla.org/network/file-output-stream;1"]
      .createInstance(Components.interfaces.nsIFileOutputStream);
  let flags = FileUtils.MODE_WRONLY | FileUtils.MODE_APPEND;
  outputStream.init(Storage.dataFile, flags, 666, 0);
  let converterOutputStream = Cc["@mozilla.org/intl/converter-output-stream;1"]
      .createInstance(Components.interfaces.nsIConverterOutputStream);
  converterOutputStream.init(outputStream, "UTF-8", 0, 0);
  return converterOutputStream;
}

let dataOutputStream;

let Storage = exports.Storage = {};

Storage.init = function()
{
  Storage.dataFile = createTemporaryFile("crawler-data");
  dataOutputStream = openOutputStream(Storage.dataFile);
};

Storage.destroy = function()
{
  dataOutputStream.close();
  Storage.dataFile.remove(true);
};

Storage.write = function()
{
  dataOutputStream.writeString(data);
};
