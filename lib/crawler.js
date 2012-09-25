Cu.import("resource://gre/modules/Services.jsm");

function abprequire(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  return result.exports;
}

let {Storage} = require("storage");
let {Client} = require("client");

let {Policy} = abprequire("contentPolicy");
let {Filter} = abprequire("filterClasses");
let {Utils} = abprequire("utils");

let origProcessNode = Policy.processNode;

let siteTabs;
let currentTabs;

function processNode(wnd, node, contentType, location, collapse)
{
  let result = origProcessNode.apply(this, arguments);
  let url = (contentType === Policy.type.ELEMHIDE) ? location.text :
      location.spec;
  let topWindow = wnd.top;
  let tabbrowser = Utils.getChromeWindow(topWindow).gBrowser;
  let browser = tabbrowser.getBrowserForDocument(topWindow.document);
  let site = siteTabs.get(browser);
  let filtered = !result;
  Storage.write([url, site, filtered]);
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
        siteTabs.set(browser, site);
    }
  };
  tabbrowser.addTabsProgressListener(progressListener);
}

function loadSites(backendUrl, parallelTabs, window, sites, callback)
{
  while (currentTabs < parallelTabs && sites.length)
  {
    currentTabs++;
    let site = sites.shift();
    loadSite(site, window, function()
    {
      currentTabs--;
      if (!sites.length && !currentTabs)
      {
        Storage.finish();
        let dataFilePath = Storage.dataFile.path;
        Client.sendCrawlerDataFile(backendUrl, dataFilePath, function()
        {
          Storage.destroy();
          callback();
        });
      }
      else
        loadSites(backendUrl, parallelTabs, window, sites, callback);
    });
  }
}

let Crawler = exports.Crawler = {};

Crawler.crawl = function(backendUrl, parallelTabs, window, callback)
{
  if (Policy.processNode != origProcessNode)
    return;

  Policy.processNode = processNode;

  siteTabs = new WeakMap();
  currentTabs = 0;

  Storage.init();

  Client.fetchCrawlableSites(backendUrl, function(sites)
  {
    loadSites(backendUrl, parallelTabs, window, sites, function()
    {
      Policy.processNode = origProcessNode;
      callback();
    });
  });
};
