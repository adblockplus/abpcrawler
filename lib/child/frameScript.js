/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

/**
 * @param e exception
 */
function reportException(e)
{
  let stack = "";
  if (e && typeof e == "object" && "stack" in e)
    stack = e.stack + "\n";

  Cu.reportError(e);
  dump(e + "\n" + stack + "\n");
}

const {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});

/**
 * Progress listener capturing the data of the current page and calling
 * onPageLoaded(data) when loading is finished, where data contains
 * HTTP status and headers.
 *
 * @type nsIWebProgressListener
 */
let webProgressListener =
{
  onStateChange: function(webProgress, request, flags, status)
  {
    if (webProgress.DOMWindow == content &&
        (flags & Ci.nsIWebProgressListener.STATE_STOP))
    {
      // First time we receive STATE_STOP for about:blank and the second time
      // for our interested URL which is distinct from about:blank.
      // However we should not process about:blank because it can happen that
      // the message with information about about:blank is delivered when the
      // code in crawler.js is already waiting for a message from this tab.
      // Another case we are not interested in is about:newtab.
      if (content.location.protocol == "about:")
        return;
      let pageInfo = {channelStatus: status};
      if (request instanceof Ci.nsIHttpChannel)
      {
        try
        {
          pageInfo.headers = [];
          pageInfo.headers.push("HTTP/x.x " + request.responseStatus + " " + request.responseStatusText);
          request.visitResponseHeaders((header, value) => pageInfo.headers.push(header + ": " + value));
        }
        catch (e)
        {
          reportException(e);
        }
      }
      onPageLoaded(pageInfo);
    }
  },

  onLocationChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {},

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference])
};

function onPageLoaded(pageInfo)
{
  Object.assign(pageInfo, gatherPageInfo(content));
  sendAsyncMessage("abpcrawler:pageInfoGathered", pageInfo);
};

let webProgress = docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebProgress);
webProgress.addProgressListener(webProgressListener, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);

/**
 * Gathers information about a DOM window.
 * Currently
 *  - creates a screenshot of the page
 *  - serializes the page source code
 * @param {nsIDOMWindow} wnd window to process
 * @return {Object} the object containing "screenshot" and "source" properties.
 */
function gatherPageInfo(wnd)
{
  let document = wnd.document;
  let result = {errors:[]};
  if (!document.documentElement)
  {
    result.errors.push("No document.documentElement");
    return result;
  }

  try
  {
    let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = document.documentElement.scrollWidth;
    canvas.height = document.documentElement.scrollHeight;
    let context = canvas.getContext("2d");
    context.drawWindow(wnd, 0, 0, canvas.width, canvas.height, "rgb(255, 255, 255)");
    result.screenshot = canvas.toDataURL("image/jpeg", 0.8);
  }
  catch (e)
  {
    reportException(e);
    result.errors.push("Cannot make page screenshot");
  }

  try
  {
    // TODO: Capture frames as well?
    let serializer = new wnd.XMLSerializer();
    result.source = serializer.serializeToString(document.documentElement);
  }
  catch(e)
  {
    reportException(e);
    result.errors.push("Cannot obtain page source code");
  }

  return result;
}
