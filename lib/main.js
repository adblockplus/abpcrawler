/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

Cu.import("resource://gre/modules/Services.jsm");

let {WindowObserver} = require("windowObserver");

let knownWindowTypes =
{
  "navigator:browser": true,
  "mail:3pane": true,
  "mail:messageWindow": true,
  __proto__: null
};

new WindowObserver({
  applyToWindow: function(window)
  {
    let type = window.document.documentElement.getAttribute("windowtype");
    if (!(type in knownWindowTypes))
      return;

    window.addEventListener("popupshowing", popupShowingHandler, false);
    window.addEventListener("popuphidden", popupHiddenHandler, false);
  },

  removeFromWindow: function(window)
  {
    let type = window.document.documentElement.getAttribute("windowtype");
    if (!(type in knownWindowTypes))
      return;

    window.removeEventListener("popupshowing", popupShowingHandler, false);
    window.removeEventListener("popuphidden", popupHiddenHandler, false);
  }
});

function getMenuItem()
{
  // Randomize URI to work around bug 719376
  let stringBundle = Services.strings.createBundle("chrome://abpcrawler/locale/global.properties?" + Math.random());
  let result = [stringBundle.GetStringFromName("crawler.label")];

  getMenuItem = function() result;
  return getMenuItem();
}

function popupShowingHandler(event)
{
  let popup = event.target;
  if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
    return;

  popupHiddenHandler(event);

  let [label] = getMenuItem();
  let item = popup.ownerDocument.createElement("menuitem");
  item.setAttribute("label", label);
  item.setAttribute("class", "abpcrawler-item");

  item.addEventListener("command", popupCommandHandler, false);

  let insertBefore = null;
  for (let child = popup.firstChild; child; child = child.nextSibling)
    if (/-options$/.test(child.id))
      insertBefore = child;
  popup.insertBefore(item, insertBefore);
}

function popupHiddenHandler(event)
{
  let popup = event.target;
  if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
    return;

  let items = popup.getElementsByClassName("abpcrawler-item");
  while (items.length)
    items[0].parentNode.removeChild(items[0]);
}

function popupCommandHandler(event)
{
  if (!("@adblockplus.org/abp/public;1" in Cc))
    return;

  let crawlerWnd = Services.wm.getMostRecentWindow("abpcrawler:crawl");
  if (crawlerWnd)
    crawlerWnd.focus();
  else
    event.target.ownerDocument.defaultView.openDialog("chrome://abpcrawler/content/crawler.xul", "_blank", "chrome,centerscreen,resizable,dialog=no");
}
