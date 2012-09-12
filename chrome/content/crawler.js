/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

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

let backendUrl;
let crawlerRunId;
let siteTabs;
let currentTabs;

function get(url, callback)
{
  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  request.mozBackgroundRequest = true;
  request.open("GET", url);
  if (callback)
    request.addEventListener("load", function()
    {
      callback(request);
    });
  request.send();
}

function sendCrawlerData(url, filtered, site)
{
  let requestUrl = backendUrl + "/crawlerData?run=" + crawlerRunId + "&site=" +
      encodeURIComponent(site) + "&url=" + encodeURIComponent(url) +
      "&filtered=" + filtered;
  get(requestUrl);
}

function processNode(wnd, node, contentType, location, collapse)
{
  let result = origProcessNode.apply(this, arguments);
  let url = location.spec;
  if (url)
  {
    let filtered = !result;
    let site = siteTabs[wnd.top.document];
    sendCrawlerData(url, filtered, site);
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

function fetchCrawlableSites(callback)
{
  get(backendUrl + "/crawlableUrls", function(request)
  {
    let sites = request.responseText.trim().split("\n");
    callback(sites);
  });
}

function initCrawlerRun(callback)
{
  get(backendUrl + "/crawlerRun", function(request)
  {
    callback(request.responseText);
  });
}

function loadSite(site, callback)
{
  let tabbrowser = window.opener.gBrowser;
  let tab = tabbrowser.addTab(site);
  let tabDocument = tabbrowser.getBrowserForTab(tab).contentDocument;
  siteTabs[tabDocument] = site;
  let progressListener = {
    onStateChange: function(aBrowser, aWebProgress, aRequest, aStateFlags, aStatus)
    {
      if (!(aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_STOP && aStatus === 0))
        return;

      window.opener.gBrowser.removeTabsProgressListener(progressListener);
      window.opener.gBrowser.removeTab(tab);
      callback();
    }    
  }
  window.opener.gBrowser.addTabsProgressListener(progressListener);    
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
      loadSites(sites);
    });
  }
}

function crawl()
{
  siteTabs = {};
  currentTabs = 0;
  let backendUrlTextBox = document.getElementById("backend-url");
  backendUrl = backendUrlTextBox.value;
  fetchCrawlableSites(function(sites)
  {
    initCrawlerRun(function(runId)
    {
      crawlerRunId = runId;
      loadSites(sites);
    });
  });
}
