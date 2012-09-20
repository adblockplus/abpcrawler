Cu.import("resource://gre/modules/Services.jsm");

function require(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "abpcrawler-require", module);
  return result.exports;
}

function abprequire(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  if ("exports" in result)
    return result.exports;
  else
    return Cu.import("chrome://adblockplus-modules/content/" +
                     module[0].toUpperCase() + module.substr(1) + ".jsm", null);
}

let {Storage} = require("storage");
let {Client} = require("client");

let {Policy} = abprequire("contentPolicy");
let {Filter} = abprequire("filterClasses");

let origProcessNode = Policy.processNode;

let siteTabs;
let currentTabs;

function storeCrawlerData(url, site, filtered)
{
  let data = JSON.stringify([url, site, filtered]) + "\n";
  Storage.write(data);
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

function loadSite(site, window, callback)
{
  if (!site)
    return;

  let tabbrowser = window.gBrowser;
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

function loadSites(backendUrl, parallelTabs, window, sites, callback)
{
  while (currentTabs < parallelTabs && sites.length)
  {
    currentTabs++;
    let site = sites[0];
    sites = sites.slice(1);
    loadSite(site, window, function()
    {
      currentTabs--;
      if (!sites.length && !currentTabs)
        Client.sendCrawlerDataFile(backendUrl, window, Storage.dataFile, function()
        {
          Storage.destroy();
          callback();
        });
      else
        loadSites(backendUrl, parallelTabs, window, sites, callback);
    });
  }
}

let Crawler = exports.Crawler = {};

Crawler.crawl = function(backendUrl)
{
  Policy.processNode = processNode;

  siteTabs = {};
  currentTabs = 0;

  Storage.init();

  Client.fetchCrawlableSites(backendUrl, function(sites)
  {
    // TODO: Pass these as arguments
    const parallelTabs = 5;
    let window = Services.wm.getMostRecentWindow("navigator:browser");
    loadSites(backendUrl, parallelTabs, window, sites, function()
    {
      Policy.processNode = origProcessNode;
    });
  });
};
