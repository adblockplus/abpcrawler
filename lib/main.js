/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

"use strict";

/**
 * @module main
 */

const {Services} = Cu.import("resource://gre/modules/Services.jsm", {});
const {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
const {Promise} = Cu.import("resource://gre/modules/Promise.jsm", {});

require("commandLine");
let {run} = require("crawler");

let baseURL = null;

/**
 * Waits for the application to initialize.
 * @type {Promise}
 */
let applicationReady = (function()
{
  let deferred = Promise.defer();

  let observer = {
    observe: function(subject, topic, data)
    {
      Services.obs.removeObserver(this, "sessionstore-windows-restored");
      deferred.resolve();
    },
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
  };

  Services.obs.addObserver(observer, "sessionstore-windows-restored", true);
  onShutdown.add(() => Services.obs.removeObserver(observer, "sessionstore-windows-restored"));

  return deferred.promise;
})();

/**
 * Startup function, called from command line handler.
 *
 * @param {int} port  Port to communicate with
 */
function startup(port)
{
  baseURL = "http://localhost:" + port + "/";

  let request = new XMLHttpRequest();
  request.open("GET", baseURL + "parameters");
  request.addEventListener("load", onParametersLoaded, false);
  request.addEventListener("error", onParametersFailed, false);
  request.responseType = "json";
  request.send();
}
exports.startup = startup;

/**
 * Called if parameters loaded succesfully.
 *
 * @param {Event} event
 */
function onParametersLoaded(event)
{
  let {urls, timeout, maxtabs} = event.target.response;

  applicationReady.then(function()
  {
    let window = Services.wm.getMostRecentWindow("navigator:browser");
    run(window, urls, timeout, maxtabs, baseURL + "save", function()
    {
      Services.startup.quit(Services.startup.eAttemptQuit);
    });
  }, function(exception)
  {
    Cu.reportError(exception);
    dump(exception + "\n")
  });
}

/**
 * Called if requesting parameters failed.
 *
 * @param {Event} event
 */
function onParametersFailed(event)
{
  Cu.reportError("Failed loading parameters");
}
