Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function abprequire(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  if ("exports" in result)
    return result.exports;
  else
    return Cu.import("chrome://adblockplus-modules/content/" + module[0].toUpperCase() + module.substr(1) + ".jsm", null);
}

let {Policy} = abprequire("contentPolicy");
let {Filter} = abprequire("filterClasses");

let siteTabs;
let currentTabs;
let crawlerDataFile;
let crawlerDataOutputStream;

function storeCrawlerData(url, site, filtered)
{
  let data = JSON.stringify([url, site, filtered]) + "\n";
  crawlerDataOutputStream.writeString(data);
}

function processNode(wnd, node, contentType, location, collapse)
{
  let result = origProcessNode.apply(this, arguments);
  let url = location.spec;
  if (url)
  {
    let site = siteTabs[wnd.top.location.href];
    let filtered = !result;
    storeCrawlerData(url, site, filtered);
  }
  return result;
}

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
  outputStream.init(crawlerDataFile, flags, 666, 0); 
  let converterOutputStream = Cc["@mozilla.org/intl/converter-output-stream;1"]
      .createInstance(Components.interfaces.nsIConverterOutputStream);
  converterOutputStream.init(outputStream, "UTF-8", 0, 0);
  return converterOutputStream;
}

function get(url, callback)
{
  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
      .createInstance(Ci.nsIXMLHttpRequest);
  request.mozBackgroundRequest = true;
  request.open("GET", url);
  if (callback)
    request.addEventListener("load", function()
    {
      callback(request);
    });
  request.send();
}

function fetchCrawlableSites(backendUrl, callback)
{
  get(backendUrl + "/crawlableSites", function(request)
  {
    let sites = request.responseText.trim().split("\n");
    callback(sites);
  });
}

function loadSite(site, callback)
{
  if (!site)
    return;

  let tabbrowser = Services.wm.getMostRecentWindow("navigator:browser").gBrowser;
  let tab = tabbrowser.addTab(site);
  let browser = tabbrowser.getBrowserForTab(tab);

  let progressListener = {
    onStateChange: function(aBrowser, aWebProgress, aRequest, aStateFlags, aStatus)
    {
      if (browser !== aBrowser)
        return;

      if (!(aStateFlags & Ci.nsIWebProgressListener.STATE_STOP))
        return;

      tabbrowser.removeTabsProgressListener(progressListener);
      tabbrowser.removeTab(tab);
      callback();
    },
    onLocationChange: function(aBrowser, aWebProgress, aRequest, aLocation, aFlags)
    {
      if (browser === aBrowser)
        siteTabs[aLocation.spec] = site;
    }
  };
  tabbrowser.addTabsProgressListener(progressListener);    
}

function postFile(url, file, callback)
{
  let formData = new FormData();
  formData.append("file", new File(file.path));

  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
      .createInstance(Ci.nsIXMLHttpRequest);
  request.mozBackgroundRequest = true;
  request.open("POST", url);
  if (callback)
    request.addEventListener("load", function()
    {
      callback(request);
    });
  request.send(formData);
}

function sendCrawlerData(backendUrl)
{
  crawlerDataOutputStream.close();
  postFile(backendUrl + "/crawlerData", crawlerDataFile, function()
  {
    crawlerDataFile.remove(true);
  });
}

function loadSites(backendUrl, sites)
{
  let parallelTabs = 5; // TODO: Make this configurable
  while (currentTabs < parallelTabs && sites.length)
  {
    currentTabs++;
    let site = sites[0];
    sites = sites.slice(1);
    loadSite(site, function()
    {
      currentTabs--;
      if (!sites.length && !currentTabs)
        sendCrawlerData(backendUrl);
      else
        loadSites(backendUrl, sites);
    });
  }
}

exports.Crawler = {};

exports.crawl = function(backendUrl)
{
  let origProcessNode = Policy.processNode;  
  Policy.processNode = processNode;

  siteTabs = {};
  currentTabs = 0;
  crawlerDataFile = createTemporaryFile("crawler-data");
  crawlerDataOutputStream = openOutputStream(crawlerDataFile);

  fetchCrawlableSites(backendUrl, function(sites)
  {
    loadSites(backendUrl, sites);
  });

  if (origProcessNode)
    Policy.processNode = origProcessNode;
}
