/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

"use strict";

/**
 * @module crawler
 */

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/Promise.jsm");

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
      // navigate away from early opened URL
      tab.linkedBrowser.loadURI('about:blank', null, null);
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
 * Observes page loads in a particular tabbed browser.
 *
 * @param {tabbrowser} browser
 *    The tabbed browser to be observed
 * @param {int} timeout
 *    Load timeout in milliseconds
 * @constructor
 */
function LoadListener(browser, timeout)
{
  this._browser = browser;
  this._deferred = new Map();
  this._timeout = timeout;
  browser.addTabsProgressListener(this);
}
LoadListener.prototype = {
  /**
   * Returns a promise that will be resolved when the page in the specified tab
   * finishes loading. Loading will be stopped if the timeout is reached.
   *
   * @param {tab} tab
   * @result {Promise}
   */
  waitForLoad: function(tab)
  {
    let deferred = Promise.defer();
    this._deferred.set(tab.linkedBrowser, deferred);

    tab.ownerDocument.defaultView.setTimeout(function()
    {
      tab.linkedBrowser.stop();
    }, this._timeout);

    return deferred.promise;
  },

  /**
   * Deactivates this object.
   */
  stop: function()
  {
    this._browser.removeTabsProgressListener(this);
  },

  onStateChange: function(browser, progress, request, flags, status)
  {
    if ((flags & Ci.nsIWebProgressListener.STATE_STOP) && (flags & Ci.nsIWebProgressListener.STATE_IS_WINDOW))
    {
      let deferred = this._deferred.get(browser);
      if (deferred)
      {
        this._deferred.delete(browser);

        let headers = [];
        if (request instanceof Ci.nsIHttpChannel)
        {
          try
          {
            headers.push("HTTP/x.x " + request.responseStatus + " " + request.responseStatusText);
            request.visitResponseHeaders((header, value) => headers.push(header + ": " + value));
          }
          catch (e)
          {
            // Exceptions are expected here
          }
        }
        deferred.resolve([status, headers]);
      }
    }
  }
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
  let loadListener = new LoadListener(window.getBrowser(), timeout);
  let running = 0;
  let windowCloser = new WindowCloser();
  let taskDone = function()
  {
    running--;
    if (running <= 0)
    {
      loadListener.stop();
      windowCloser.stop();
      onDone();
    }
  };

  for (let url of urls)
  {
    running++;
    Task.spawn(crawl_url.bind(null, url, tabAllocator, loadListener)).then(function(result)
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
 * Crawls a URL. This is a generator meant to be used via a Task object.
 *
 * @param {String} url
 * @param {TabAllocator} tabAllocator
 * @param {loadListener} loadListener
 * @result {Object}
 *    Crawling result
 */
function* crawl_url(url, tabAllocator, loadListener)
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
    [result.channelStatus, result.headers] = yield loadListener.waitForLoad(tab);
    result.endTime = Date.now();
    result.finalUrl = tab.linkedBrowser.currentURI.spec;

    let document = tab.linkedBrowser.contentDocument;
    if (document.documentElement)
    {
      try
      {
        let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = document.documentElement.scrollWidth;
        canvas.height = document.documentElement.scrollHeight;

        let context = canvas.getContext("2d");
        context.drawWindow(document.defaultView, 0, 0, canvas.width, canvas.height, "rgb(255, 255, 255)");
        result.screenshot = canvas.toDataURL("image/jpeg", 0.8);
      }
      catch (e)
      {
        reportException(e);
        result.error = "Capturing screenshot failed: " + e;
      }

      // TODO: Capture frames as well?
      let serializer = new tab.ownerDocument.defaultView.XMLSerializer();
      result.source = serializer.serializeToString(document.documentElement);
    }
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
