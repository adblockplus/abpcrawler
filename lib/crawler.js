/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

"use strict";

/**
 * @module crawler
 */

const {Services} = Cu.import("resource://gre/modules/Services.jsm", {});
const {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
const {Task} = Cu.import("resource://gre/modules/Task.jsm", {});
const {setTimeout, clearTimeout} = Cu.import("resource://gre/modules/Timer.jsm", {});

function abprequire(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  return result.exports;
}

let {RequestNotifier} = abprequire("requestNotifier");
let {FilterNotifier} = abprequire("filterNotifier");
let {FilterStorage} = abprequire("filterStorage");

/**
 * Allocates tabs on request but not more than maxtabs at the same time.
 *
 * @param {tabbrowser} browser
 *    The tabbed browser where tabs should be created
 * @param {int} maxtabs
 *    The maximum number of tabs to be allocated
 * @constructor
 */
function TabAllocator(browser, maxtabs)
{
  this._browser = browser;
  this._tabs = 0;
  this._maxtabs = maxtabs;
  // The queue containing resolve functions of promises waiting for a tab.
  this._resolvers = [];
  // Keep at least one tab alive to prevent browser from closing itself.
  this._tabKeepingWindowAlive = this._browser.tabs[0];
  this._browser.removeAllTabsBut(this._tabKeepingWindowAlive);
}
TabAllocator.prototype = {
  _removeTabKeepingWindowAlive: function()
  {
    if (!this._tabKeepingWindowAlive)
      return;
    this._browser.removeTab(this._tabKeepingWindowAlive);
    delete this._tabKeepingWindowAlive;
  },

  /**
   * Creates a blank tab in this._browser.
   *
   * @return {Promise.<tab>} promise which resolves once the tab is fully initialized.
   */
  _createTab: function()
  {
    this._tabs++;
    let tab = this._browser.addTab("about:blank");
    if (tab.linkedBrowser.outerWindowID)
    {
      this._removeTabKeepingWindowAlive();
      return Promise.resolve(tab);
    }
    return new Promise((resolve, reject) =>
    {
      let onBrowserInit = (msg) =>
      {
        tab.linkedBrowser.messageManager.removeMessageListener("Browser:Init", onBrowserInit);
        this._removeTabKeepingWindowAlive();
        resolve(tab);
      };
      // "Browser:Init" message is sent once the browser is ready, see
      // https://bugzil.la/1256602#c1
      tab.linkedBrowser.messageManager.addMessageListener("Browser:Init", onBrowserInit);
    });
  },

  /**
   * Returns a promise that will resolve into a tab once a tab is allocated.
   * The tab cannot be used by other tasks until releaseTab() is called.
   *
   * @result {Promise.<tab>}
   */
  getTab: function()
  {
    if (this._tabs < this._maxtabs)
      return this._createTab();
    return new Promise((resolve, reject) => this._resolvers.push(resolve));
  },

  /**
   * Adds a tab back to the pool so that it can be used by other tasks.
   *
   * @param {tab} tab
   */
  releaseTab: function(tab)
  {
    // If we are about to close last tab don't close it immediately to keep
    // the window alive. It will be closed when a new tab is created.
    if (this._tabs > 1)
      this._browser.removeTab(tab);
    else
    {
      // navigate away from previously opened URL
      tab.linkedBrowser.loadURI("about:blank", null, null);
      this._tabKeepingWindowAlive = tab;
    }

    this._tabs--;
    if (this._resolvers.length && this._tabs < this._maxtabs)
    {
      this._resolvers.shift()(this._createTab());
    }
  },
};

/**
 * Once created, this object will make sure all new windows are dismissed
 * immediately.
 *
 * @constructor
 */
function WindowCloser()
{
  Services.obs.addObserver(this, "xul-window-registered", true)
}
WindowCloser.prototype = {
  /**
   * Deactivates this object.
   */
  stop: function()
  {
    Services.obs.removeObserver(this, "xul-window-registered")
  },

  observe: function(subject, topic, data)
  {
    let window = subject.QueryInterface(Ci.nsIInterfaceRequestor)
                        .getInterface(Ci.nsIDOMWindow)
    window.addEventListener("load", function()
    {
      if (window.document.documentElement.localName == 'dialog')
        window.document.documentElement.acceptDialog();
      else
        window.close();
    }, false);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};

function configureFrameScript()
{
  const info = require("info");
  let frameScriptPath = info.addonRoot + "/lib/child/frameScript.js";
  Services.mm.loadFrameScript(frameScriptPath, true);

  onShutdown.add(() =>
  {
    Services.mm.removeDelayedFrameScript(frameScriptPath);
  });
}

/**
 * Starts the crawling session. The crawler opens each URL in a tab and stores
 * the results.
 *
 * @param {Window} window
 *    The browser window we're operating in
 * @param {String[]} urls
 *    URLs to be crawled
 * @param {int} timeout
 *    Load timeout in milliseconds
 * @param {int} maxtabs
 *    Maximum number of tabs to be opened
 * @param {String} targetURL
 *    URL that should receive the results
 * @param {Function} onDone
 *    The callback which is called after finishing of crawling of all URLs.
 */
function run(window, urls, timeout, maxtabs, targetURL, onDone)
{
  configureFrameScript();
  new Promise((resolve, reject) =>
  {
    if (FilterStorage.subscriptions.length > 0)
    {
      resolve();
      return;
    }
    let onFiltersLoaded = (action, item, newValue, oldValue) =>
    {
      if (action == "load")
      {
        FilterNotifier.removeListener(onFiltersLoaded);
        resolve();
      }
    };
    FilterNotifier.addListener(onFiltersLoaded);
  }).then(() => crawl_urls(window, urls, timeout, maxtabs, targetURL, onDone))
  .catch(reportException);
}
exports.run = run;

/**
 * Spawns a {Task} task to crawl each url from urls argument and calls
 * onDone when all tasks are finished.
 * @param {Window} window
 *   The browser window we're operating in
 * @param {String[]} urls
 *   URLs to be crawled
 * @param {int} timeout
 *    Load timeout in milliseconds
 * @param {int} maxtabs
 *    Maximum number of tabs to be opened
 * @param {String} targetURL
 *    URL that should receive the results
 * @param {Function} onDone
 *    The callback which is called after finishing of all tasks.
 */
function crawl_urls(window, urls, timeout, maxtabs, targetURL, onDone)
{
  let tabAllocator = new TabAllocator(window.getBrowser(), maxtabs);

  let running = 0;
  let windowCloser = new WindowCloser();
  let taskDone = function()
  {
    running--;
    if (running <= 0)
    {
      windowCloser.stop();
      onDone();
    }
  };

  for (let url of urls)
  {
    running++;
    Task.spawn(crawl_url.bind(null, url, tabAllocator, timeout)).then(function(result)
    {
      let request = new XMLHttpRequest();
      request.open("POST", targetURL);
      request.addEventListener("load", taskDone, false);
      request.addEventListener("error", taskDone, false);
      request.send(JSON.stringify(result));
    }, function(url, exception)
    {
      reportException(exception);

      let request = new XMLHttpRequest();
      request.open("POST", targetURL);
      request.addEventListener("load", taskDone, false);
      request.addEventListener("error", taskDone, false);
      request.send(JSON.stringify({
        url: url,
        startTime: Date.now(),
        error: String(exception)
      }));
    }.bind(null, url));
  }
}

/**
 * Expects to receive page info gathered in a content process for the specified
 * `tab`. If there is no relevant message within specified `timeout` then
 * the result promise is resolved with error object.
 * @param tab
 *    Tab in which we are interested in
 * @param {int} timeout
 *    Timeout in milliseconds
 * @return {Promise} promise which will be resolved with the received page info
 */
function getPageInfo(tab, timeout)
{
  return new Promise((resolve, result) =>
  {
    let mm = tab.linkedBrowser.messageManager;
    let timerID;
    let onDone = (msg) =>
    {
      mm.removeMessageListener("abpcrawler:pageInfoGathered", onDone);
      clearTimeout(timerID);
      resolve(msg.data);
    }
    mm.addMessageListener("abpcrawler:pageInfoGathered", onDone);
    timerID = setTimeout(() => onDone({data: {error: "timeout"}}), timeout);
  });
}

/**
 * Crawls a URL. This is a generator meant to be used via a Task object.
 *
 * @param {String} url
 * @param {TabAllocator} tabAllocator
 * @param {int} timeout
 *    Load timeout in milliseconds
 * @result {Object}
 *    Crawling result
 */
function* crawl_url(url, tabAllocator, timeout)
{
  let tab = yield tabAllocator.getTab();
  let result = {url, requests: []};
  let requestNotifier;
  try
  {
    result.startTime = Date.now();
    requestNotifier = new RequestNotifier(tab.linkedBrowser.outerWindowID,
      function(entry, scanComplete)
    {
      if (!entry)
        return;
      let {type: contentType, location, filter} = entry;
      result.requests.push({location, contentType, filter});
    });

    tab.linkedBrowser.loadURI(url, null, null);

    Object.assign(result, yield getPageInfo(tab, timeout));
    result.finalUrl = tab.linkedBrowser.currentURI.spec;
    result.endTime = Date.now();
  }
  finally
  {
    if (requestNotifier)
      requestNotifier.shutdown();
    tabAllocator.releaseTab(tab);
  }
  return result;
}

function reportException(e)
{
  let stack = "";
  if (e && typeof e == "object" && "stack" in e)
    stack = e.stack + "\n";

  Cu.reportError(e);
  dump(e + "\n" + stack + "\n");
}
