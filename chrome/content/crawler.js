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

let policyGlobal = Cu.getGlobalForObject(Policy);
let PolicyPrivate = null;
if (policyGlobal == window)
{
  // Work-around for bug 736316 - getGlobalForObject gave us our own window
  let {XPIProvider} = Cu.import("resource://gre/modules/XPIProvider.jsm", null);
  let addonID = "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}"
  if (addonID in XPIProvider.bootstrapScopes)
    policyGlobal = XPIProvider.bootstrapScopes[addonID];
}

if ("PolicyPrivate" in policyGlobal)              // ABP 2.0.x
  PolicyPrivate = policyGlobal.PolicyPrivate;
else if ("PolicyImplementation" in policyGlobal)  // ABP 2.1+ with scope separation
  PolicyPrivate = policyGlobal.PolicyImplementation;
else if ("require" in policyGlobal)               // ABP 2.1+ without scope separation
  PolicyPrivate = policyGlobal.require.scopes.contentPolicy.PolicyImplementation;
else
  window.close();

let origShouldLoad = PolicyPrivate.shouldLoad;
let origProcessNode = Policy.processNode;

let backendUrl;
let crawlerRunId;
let currentSite;

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

function sendCrawlerData(url)
{
  let requestUrl = backendUrl + "/crawlerData?run=" + crawlerRunId + "&site=" +
      encodeURIComponent(currentSite) + "&url=" + encodeURIComponent(url);
  get(requestUrl);
}

function handleNode(result, location)
{
  if (result === Ci.nsIContentPolicy.REJECT_REQUEST)
    sendCrawlerData(location.spec);
}

function shouldLoad(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra)
{
  let result = origShouldLoad.apply(this, arguments);
  handleNode(result, contentLocation);
  return result;
}

function processNode(wnd, node, contentType, location, collapse)
{
  let result = origProcessNode.apply(this, arguments);
  handleNode(result, location);
  return result;
}

function init()
{
  PolicyPrivate.shouldLoad = shouldLoad;
  Policy.processNode = processNode;
}

function destroy()
{
  if (origShouldLoad)
    PolicyPrivate.shouldLoad = origShouldLoad;
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
  currentSite = site;
  let tab = window.opener.gBrowser.addTab(site);
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
  if (!sites.length)
    return;

  loadSite(sites[0], function()
  {
    loadSites(sites.slice(1));
  });
}

function crawl()
{
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
