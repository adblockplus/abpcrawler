/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

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

let {Policy} = abprequire("contentPolicy");
let {RequestNotifier} = abprequire("requestNotifier");
let {Utils} = abprequire("utils");

let dataForTab = new WeakMap();

/**
 * Creates a pool of tabs and allocates them to tasks on request.
 *
 * @param {tabbrowser} browser
 *    The tabbed browser where tabs should be created
 * @param {int} maxtabs
 *    The maximum number of tabs to be allocated
 * @constructor
 */
function TabAllocator(browser, maxtabs)
{
  this._tabs = [];
  for (let i = 0; i < maxtabs; i++)
    this._tabs.push(browser.addTab("about:blank"));

  this._deferred = [];
}
TabAllocator.prototype = {
  /**
   * Returns a promise that will resolve into a tab once a tab can be allocated.
   * The tab cannot be used by other tasks until releaseTab() is called.
   *
   * @result {Promise}
   */
  getTab: function()
  {
    if (this._tabs.length)
      return this._tabs.shift();
    else
    {
      let deferred = Promise.defer();
      this._deferred.push(deferred);
      return deferred.promise;
    }
  },

  /**
   * Adds a tab back to the pool so that it can be used by other tasks.
   *
   * @param {tab} tab
   */
  releaseTab: function(tab)
  {
    if (this._deferred.length)
      this._deferred.shift().resolve(tab);
    else
      this._tabs.push(tab);
  }
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
        deferred.resolve(status);
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
 * Retrieves crawler results associated with a particular content window.
 *
 * @param {Window} window
 *    Content window to retrieve crawler results for
 * @result {Object}
 *    Crawler results or undefined if the window wasn't created by the crawler.
 */
function getDataForWindow(window)
{
  let topWindow = window.top;
  if (!topWindow.document)
    throw new Error("No document associated with the node's top window");
  let tabbrowser = Utils.getChromeWindow(topWindow).getBrowser();
  if (!tabbrowser)
    throw new Error("Unable to get a tabbrowser reference from the window");
  let browser = tabbrowser.getBrowserForDocument(topWindow.document);
  if (!browser)
    throw new Error("Unable to get browser for the content window");
  let tab = tabbrowser.getTabForBrowser(browser);
  if (!tab)
    throw new Error("Unable to get tab for the browser");
  return dataForTab.get(tab);
};

/**
 * Starts the crawling session. The crawler opens each URL in a tab and stores
 * the results.
 *
 * @param {Window} window
 *    The browser window we're operating in
 * @param {String[]} urls
 *    URLs to be crawled
 * @param {int} number_of_tabs
 *    Maximum number of tabs to be opened
 * @param {String} targetURL
 *    URL that should receive the results
 */
function run(window, urls, timeout, maxtabs, targetURL, onDone)
{
  let requestNotifier = new RequestNotifier(null, function() {});

  let origProcessNode = Policy.processNode;
  Policy.processNode = processNodeReplacement.bind(null, origProcessNode, requestNotifier);

  let tabAllocator = new TabAllocator(window.getBrowser(), maxtabs);
  let loadListener = new LoadListener(window.getBrowser(), timeout);
  let running = 0;
  let windowCloser = new WindowCloser();
  let taskDone = function()
  {
    running--;
    if (running <= 0)
    {
      Policy.processNode = origProcessNode;
      requestNotifier.shutdown();
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
    }, function(exception)
    {
      Cu.reportError(exception);
      dump(exception + "\n")
      onDone();
    });
  }
}
exports.run = run;

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
  let result = {url: url};

  dataForTab.set(tab, result);
  try
  {
    result.startTime = Date.now();
    tab.linkedBrowser.loadURI(url, null, null);
    result.nsresult = yield loadListener.waitForLoad(tab);
    result.endTime = Date.now();
    result.finalUrl = tab.linkedBrowser.currentURI.spec;

    let document = tab.linkedBrowser.contentDocument;
    if (document.documentElement)
    {
      let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = document.documentElement.scrollWidth;
      canvas.height = document.documentElement.scrollHeight;

      let context = canvas.getContext("2d");
      context.drawWindow(document.defaultView, 0, 0, canvas.width, canvas.height, "rgb(255, 255, 255)");
      result.screenshot = canvas.toDataURL();

      // TODO: Capture frames as well?
      let serializer = new tab.ownerDocument.defaultView.XMLSerializer();
      result.source = serializer.serializeToString(document.documentElement);
    }
  }
  finally
  {
    tabAllocator.releaseTab(tab);
  }
  return result;
}

/**
 * Wrapper for the Policy.processNode() function in ABP. Calls the original
 * function and records all the data.
 *
 * @param {Function} origProcessNode
 *      The original processNode function.
 * @param {RequestNotifier} requestNotifier
 *      The crawler's RequestNotifier object instance.
 * @param {nsIDOMWindow} wnd
 * @param {nsIDOMElement} node
 * @param {Number} contentType
 * @param {nsIURI} location
 * @param  {Boolean} collapse
 * @return {Boolean}
 */
function processNodeReplacement(origProcessNode, requestNotifier, wnd, node, contentType, location, collapse)
{
  let filters = [];
  let origListener = requestNotifier.listener;
  requestNotifier.listener = function(window, node, entry)
  {
    if (entry.filter)
      filters.push(entry.filter.text);
  };

  /*
   * Call the original processNode. If the original throws, then we will too, so this is outside a try clause.
   */
  let result;
  try
  {
    result = origProcessNode(wnd, node, contentType, location, collapse);
  }
  finally
  {
    requestNotifier.listener = origListener;
  }

  try
  {
    let data = getDataForWindow(wnd);
    if (data)
    {
      if (!("requests" in data))
        data.requests = [];
      data.requests.push({
        contentType: contentType,
        location: (contentType == Policy.type.ELEMHIDE ? location.text : location.spec),
        blocked: result != Ci.nsIContentPolicy.ACCEPT,
        filters: filters
      });
    }
  }
  catch (e)
  {
    Cu.reportError(e);
    dump(e + "\n")
  }
  return result;
};
