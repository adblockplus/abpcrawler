Cu.import("resource://gre/modules/FileUtils.jsm");

let outputStream;
let converterOutputStream;

function createTemporaryFile(name)
{
  let file = FileUtils.getFile("TmpD", [name]);
  file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE,
                    FileUtils.PERMS_FILE);
  return file;
}

function openOutputStream(file)
{
  let outputStream = FileUtils.openSafeFileOutputStream(file);
  let converterOutputStream = Cc["@mozilla.org/intl/converter-output-stream;1"]
      .createInstance(Ci.nsIConverterOutputStream);
  converterOutputStream.init(outputStream, "UTF-8", 0, 0);
  return [outputStream, converterOutputStream];
}

let Storage = exports.Storage = {};

Storage.init = function()
{
  Storage.dataFile = createTemporaryFile("crawler-data");
  [outputStream, converterOutputStream] = openOutputStream(Storage.dataFile);
};

Storage.write = function(data)
{
  let line = JSON.stringify(data) + "\n";
  converterOutputStream.writeString(line);
};

Storage.finish = function()
{
  converterOutputStream.flush();
  FileUtils.closeSafeFileOutputStream(outputStream);
};

Storage.destroy = function()
{
  Storage.dataFile.remove(true);
};
