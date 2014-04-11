/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

dump( "--------\n" );

Cu.import( "resource://gre/modules/Services.jsm" );

let {WindowObserver} = require( "windowObserver" );
let { Application_Session } = require( "application" );
let { Bootstrap_XPCOM } = require( "bootstrap_xpcom" );
let { Command_Line } = require( "command_line" );
dump( "main.js: all require() finished\n" );

//-------------------------------------------------------
// Main
//-------------------------------------------------------

var Main = new Bootstrap_XPCOM.Singleton_class(
  "ABP Crawler - Main",
  Components.ID( "{7beffb8d-13e4-472c-9623-e3f3d7f37383}" ),
  "@adblockplus.org/abpcrawler/main;1",
  [ Ci.nsIObserver ],
  [] );

Main.observe = function( subject, topic, data )
{
  dump( "Main.observe: topic = " + topic + ( data ? ", data = " + data : "" ) + "\n" );
  switch ( topic )
  {
    case "profile-before-change":
      this.remove_observation_topic( topic );
      break;
  }
};

/**
 * Startup function.
 *
 * Strictly speaking this is only the startup function for automatic sessions at this time. The interactive version
 * will already have initialized below.
 */
Main.startup = function()
{
  dump( "Main/startup: invoked.\n" );

  if ( !( "flags" in Command_Line ) )
  {
    throw new Error( "No flags found in Command_Line.\n" );
  }
  var flags = Command_Line.flags;
  if ( !( "abpcrawler" in flags ) || !flags.abpcrawler )
  {
    // No session for us.
    return;
  }
  /*
   * There was a command line argument that ordered an automatic run. Here we check the arguments for validity,
   * create an Application_Session, and start it running.
   */
  var session = make_session( flags );
  if ( !session )
  {
    // Error messages were already generated in make_session.
    return;
  }
  if ( !session.window )
  {
    dump( "Main: session does not have a window. Aborted.\n" );
    return;
  }
  this.session = session;
  /*
   * At this point we have a session and its window, but the window may not be initialized. So what we have to do is
   * to wait for the window to show up.
   */
  this.ready_listener = this.ready.bind( this );
  session.window.addEventListener( "load", this.ready_listener );
  // This action should really have a timeout attached to it.
  dump( "Main/startup: waiting for window load.\n");
};

/**
 * Launch the session when we're fully ready and have a window object.
 */
Main.ready = function()
{
  if ( !this.session.window.gBrowser )
  {
    dump( "Main/ready: session window does not have a 'gBrowser' member.\n" );
    this.session.window.close();
    this.session.close();
    return;
  }
  this.session.window.removeEventListener( "load", this.ready_listener );
  this.ready_listener = null;

  dump( "Main: running session.\n" );
  try
  {
    this.session.run( this.done.bind( this ) );
  }
  catch ( e )
  {
    dump( "Main: unexpected error running session = " + e.message + "\n" );
    this.done();
  }
};

Main.done = function()
{
  if ( this.session )
  {
    /*
     * We have responsibility for the window, since we created it.
     */
    if ( this.session.window )
    {
      this.session.window.close();
    }
    this.session.close();
  }
};

/*
 * Initialize the Main object. It's built individually, so this is code that would otherwise be in a constructor.
 */
try
{
  Main.init();
  Main.add_observation_topic( "profile-before-change" );
  Command_Line.set_startup_hook( Main.startup.bind( Main ) );
}
catch ( e )
{
  dump( "main.js: Unexpected exception in Main.init(): " + e.message );
}

//-------------------------------------------------------
// Automatic
//-------------------------------------------------------
function make_session( flags )
{
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
  var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService( Ci.nsIWindowWatcher );
  var window = ww.openWindow( null, "chrome://browser/content/", "abpcrawler_main", null, null );
  /*
   * 5 minute timeout
   */
  var session = new Application_Session( window, false, max_tabs, 300000, null );
  try
  {
    session.set_input_file( flags.input_file );
    session.add_output_file( flags.output_dir, base_name, true, "JSON" );
  }
  catch ( e )
  {
    dump( "abpcrawler: " + e.message + "\n" );
    return null;
  }
  return session;
}

//-------------------------------------------------------
// Setup
//-------------------------------------------------------
let knownWindowTypes =
{
  "navigator:browser": true,
  __proto__: null
};

/*
 * We initialize the interactive version, which means hooking into the menu.
 *
 * At this time, we're doing this regardless of whether we actual need an interactive session. Later, we may initialize
 * differently or not at all if we're only running an automatic session.
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
  let popup = event.originalTarget;
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
  let popup = event.originalTarget;
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
