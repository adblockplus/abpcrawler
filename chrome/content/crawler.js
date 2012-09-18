/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

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

let origProcessNode = Policy.processNode;

let siteTabs;
let currentTabs;
let backendUrl;
let crawlerDataFile;
let crawlerDataOutputStream;

function getBackendUrl()
{
  let backendUrlTextBox = document.getElementById("backend-url");
  return backendUrlTextBox.value;
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
  outputStream.init(crawlerDataFile, flags, 0666, 0); 
  let converterOutputStream = Cc["@mozilla.org/intl/converter-output-stream;1"]
      .createInstance(Components.interfaces.nsIConverterOutputStream);
  converterOutputStream.init(outputStream, "UTF-8", 0, 0);
  return converterOutputStream;
}

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

function init()
{
  Policy.processNode = processNode;
}

function destroy()
{
  if (origProcessNode)
    Policy.processNode = origProcessNode;
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

function fetchCrawlableSites(callback)
{
  get(backendUrl + "/crawlableSites", function(request)
  {
    let sites = request.responseText.trim().split("\n");
    callback(sites);
  });
}

function loadSite(site, callback)
{
  let tabbrowser = window.opener.gBrowser;
  let tab = tabbrowser.addTab(site);
  let browser = tabbrowser.getBrowserForTab(tab);

  let progressListener = {
    onStateChange: function(aBrowser, aWebProgress, aRequest, aStateFlags, aStatus)
    {
      if (browser !== aBrowser)
        return;

      if (!(aStateFlags & Ci.nsIWebProgressListener.STATE_STOP))
        return;

      window.opener.gBrowser.removeTabsProgressListener(progressListener);
      window.opener.gBrowser.removeTab(tab);
      callback();
    },
    onLocationChange: function(aBrowser, aWebProgress, aRequest, aLocation, aFlags)
    {
      // TODO: This is a bit of a hack, try to use a WeakMap with browser and
      //       getChromeWindow().gBrowser.getBrowserForDocument() instead.
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

function sendCrawlerData()
{
  crawlerDataOutputStream.close();
  postFile(backendUrl + "/crawlerData", crawlerDataFile, function()
  {
    crawlerDataFile.remove(true);
  });
}

function loadSites(sites)
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
        sendCrawlerData();
      else
        loadSites(sites);
    });
  }
}

function crawl()
{
  siteTabs = {};
  currentTabs = 0;
  backendUrl = getBackendUrl();
  crawlerDataFile = createTemporaryFile("crawler-data");
  crawlerDataOutputStream = openOutputStream(crawlerDataFile);

  fetchCrawlableSites(function(sites)
  {
    loadSites(sites);
  });
}
