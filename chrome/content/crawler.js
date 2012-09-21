/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

function require(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "abpcrawler-require", module);
  return result.exports;
}

let {Crawler} = require("crawler");

function getBackendUrl()
{
  let backendUrlTextBox = document.getElementById("backend-url");
  return backendUrlTextBox.value;
}

function getParallelTabs()
{
  let parallelTabsTextBox = document.getElementById("parallel-tabs");
  return parseInt(parallelTabsTextBox.value);
}

function crawl()
{
  let backendUrl = getBackendUrl();
  let parallelTabs = getParallelTabs();
  Crawler.crawl(backendUrl, parallelTabs, window.opener);
  return false;
}
