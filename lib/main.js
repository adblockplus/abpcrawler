/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

dump( "--------\n" );

Cu.import( "resource://gre/modules/Services.jsm" );

let {WindowObserver} = require( "windowObserver" );
let { Application_Session } = require( "application" );
dump( "main.js: require( \"command_line\" )\n" );
let { Command_Line } = require( "command_line" );
dump( "main.js: all require() finished\n" );

let knownWindowTypes =
{
  "navigator:browser": true,
  __proto__: null
};

if ( !( "flags" in Command_Line ) )
{
  dump( "No flags found in Command_line.\n" )
  var flags = {};
}
else
{
  flags = Command_Line.flags;
}
if ( ( "abpcrawler" in flags ) && flags.abpcrawler )
{
  dump( "Automatic\n" );
  /*
   * There was a command line argument that ordered an automatic run. Here we check the arguments for validity,
   * create an Application_Session, and start it running.
   */
  var session = make_session( flags );
  if ( session )
  {
    for ( let i = 0 ; i < 20 ; ++i )
      dump( "run session here\n." );
  }
  else
  {
    dump( "no session\n" );
  }
}
else
{
  dump( "Interactive.\n" );
  /*
   * We received no command line argument to indicate an automatic run. Therefore we initialize the interactive
   * version, which means hooking into the menu.
   */
  new WindowObserver( {
    applyToWindow: function( window )
    {
      let type = window.document.documentElement.getAttribute( "windowtype" );
      if ( !(type in knownWindowTypes) )
        return;

      window.addEventListener( "popupshowing", popupShowingHandler, false );
      window.addEventListener( "popuphidden", popupHiddenHandler, false );
    },

    removeFromWindow: function( window )
    {
      let type = window.document.documentElement.getAttribute( "windowtype" );
      if ( !(type in knownWindowTypes) )
        return;

      window.removeEventListener( "popupshowing", popupShowingHandler, false );
      window.removeEventListener( "popuphidden", popupHiddenHandler, false );
    }
  } );
}

//-------------------------------------------------------
// Automatic
//-------------------------------------------------------
function make_session( flags )
{
  dump( "make_session start\n" );
  /*
   * Check that the flags are syntactically correct.
   */
  if ( !( "input_file" in flags ) )
  {
    dump( "abpcrawler: Missing flag '-input_file'.\n" );
    return null;
  }
  if ( !( "output_dir" in flags ) )
  {
    dump( "abpcrawler: Missing flag '-output_dir'.\n" );
    return null;
  }
  /*
   * Provide defaults for any absent flags.
   */
  var max_tabs = ( "max_tabs" in flags ) ? flags.max_tabs : 5;
  var base_name = ( "output_base" in flags ) ? flags.output_base : "crawl_results";
  /*
   * At this point all the syntax of the arguments is valid. Now we create the actual resources used.
   */
  var window = null;
  var session = new Application_Session( window, false, max_tabs, null );
  try
  {
    session.set_input_file( flags.input_file );
    session.add_output_file( flags.output_dir, base_name, true, "JSON" );
  }
  catch ( e )
  {
    dump( "abpcrawler: " + e.message );
    return null;
  }
  return session;
}

//-------------------------------------------------------
// Interactive
//-------------------------------------------------------

function getMenuItem()
{
  // Randomize URI to work around bug 719376
  let stringBundle = Services.strings.createBundle( "chrome://abpcrawler/locale/global.properties?" + Math.random() );
  let result = [stringBundle.GetStringFromName( "crawler.label" )];

  getMenuItem = function() result;
  return getMenuItem();
}

function popupShowingHandler( event )
{
  let popup = event.target;
  if ( !/^(abp-(?:toolbar|status|menuitem)-)popup$/.test( popup.id ) )
    return;

  popupHiddenHandler( event );

  let [label] = getMenuItem();
  let item = popup.ownerDocument.createElement( "menuitem" );
  item.setAttribute( "label", label );
  item.setAttribute( "class", "abpcrawler-item" );

  item.addEventListener( "command", popupCommandHandler, false );

  let insertBefore = null;
  for ( let child = popup.firstChild ; child ; child = child.nextSibling )
    if ( /-options$/.test( child.id ) )
      insertBefore = child;
  popup.insertBefore( item, insertBefore );
}

function popupHiddenHandler( event )
{
  let popup = event.target;
  if ( !/^(abp-(?:toolbar|status|menuitem)-)popup$/.test( popup.id ) )
    return;

  let items = popup.getElementsByClassName( "abpcrawler-item" );
  while ( items.length )
    items[0].parentNode.removeChild( items[0] );
}

function popupCommandHandler( event )
{
  if ( !("@adblockplus.org/abp/public;1" in Cc) )
    return;

  let crawlerWnd = Services.wm.getMostRecentWindow( "abpcrawler:crawl" );
  if ( crawlerWnd )
    crawlerWnd.focus();
  else
    event.target.ownerDocument.defaultView.openDialog( "chrome://abpcrawler/content/crawler.xul", "_blank", "chrome,centerscreen,resizable,dialog=no" );
}
