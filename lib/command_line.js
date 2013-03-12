/*
 * A bootstrapped extension must load its own command-line handler, because it won't load from chrome.manifest. See
 * https://developer.mozilla.org/en-US/docs/Chrome_Registration and its section "Instructions supported in bootstrapped
 * add-ons". This is only barely mentioned in
 * https://developer.mozilla.org/en-US/docs/Extensions/Bootstrapped_extensions, and only in passing at that. The upshot
 * is that you have to replicate what would otherwise happen in chrome.manifest.
 *
 * A command line handler must implement the interface nsICommandLineHandler and, in order to hook into the command line
 * system, must register itself in the category "command-line-handler".  See
 * https://developer.mozilla.org/en-US/docs/XPCOM_Interface_Reference/nsICommandLineHandler
 * The value of the category entry is a service contract ID, which is used to construct an instance of the handler.
 *
 * The way to construct an instance given a contract ID is to implement nsIFactory and, in order that hook into the
 * instantiation system, must register itself with the component registrar. The component registrar is also the
 * component manager, but through the interface nsIComponentRegistrar, which is not the default interface.
 */

Cu.import( "resource://gre/modules/XPCOMUtils.jsm" );
//-----------------------------------------------------------------------------------------
// future bootstrap_xpcom.js
//-----------------------------------------------------------------------------------------

var Singleton_class = function( class_description, class_ID, contract_ID, interfaces, category_entries )
{
  this.class_description = class_description;
  this.class_ID = class_ID;
  this.contract_ID = contract_ID;
  this._xpcom_categories = category_entries;

  /**
   * Standard QI function from the XPCOM utility module.
   * @type {Function}
   */
  this.QueryInterface = XPCOMUtils.generateQI( interfaces );
};

/**
 * Initialization
 * @private
 */
Singleton_class.prototype.init = function()
{
  let registrar = Components.manager.QueryInterface( Ci.nsIComponentRegistrar );
  registrar.registerFactory( this.class_ID, this.class_description, this.contract_ID, this );

  let category_manager = Cc["@mozilla.org/categorymanager;1"].getService( Ci.nsICategoryManager );
  for ( let c of this._xpcom_categories )
  {
    //noinspection JSUnusedAssignment
    category_manager.addCategoryEntry( c.category, c.entry, this.contract_ID, false, true );
  }
  onShutdown.add( Singleton_class._deinit.bind( this ) );
};

/**
 * De-initialization function, run at shutdown time.
 *
 * This is a separate function to avoid using a closure for registering the shutdown hook.
 *
 * @private
 */
Singleton_class._deinit = function()
{
  let category_manager = Cc["@mozilla.org/categorymanager;1"].getService( Ci.nsICategoryManager );
  for ( let c of this._xpcom_categories )
  {
    //noinspection JSUnusedAssignment
    category_manager.deleteCategoryEntry( c.category, c.entry, false );
  }

  let registrar = Components.manager.QueryInterface( Ci.nsIComponentRegistrar );
  registrar.unregisterFactory( this.class_ID, this );
};

/**
 * Standard createInstance implementation for a singleton, returning 'this' rather than a new object.
 */
Singleton_class.prototype.createInstance = function( outer, iid )
{
  if ( outer )
    throw Cr.NS_ERROR_NO_AGGREGATION;
  return this.QueryInterface( iid );
};



// To be replaced by a require() in this file and an export in the new one.
var Bootstrap_XPCOM = {
  Singleton_class: Singleton_class
};
//-----------------------------------------------------------------------------------------
// Command_Line
//-----------------------------------------------------------------------------------------

/**
 * The command line handler singleton.
 *
 * This object supplies its own factory to XPCOM, so there's no need for a constructor function; instead, the factory
 * function simply returns 'this' (essentially, though it passes it through QueryInterface first).
 */
var Command_Line = new Bootstrap_XPCOM.Singleton_class(
  "ABP Crawler - Command Line Handler",
  Components.ID( "{771575E6-62FE-48CB-BC24-EAEFDDC1CA1D}" ),
  "@adblockplus.org/abpcrawler/command-line;1",
  [ Ci.nsICommandLineHandler ],
  [
    {
      category: "command-line-handler",
      // The entry starts with "k" so that it has slightly higher priority than ordinary command line handlers.
      entry: "k-abpcrawler"
    }
  ] );

Command_Line.helpInfo = "" +
  // -    -    -    -    -    -    -    -     -    -    -    -    -    -  | wrap here
  "AdBlock Plus Crawler\n" +
  "  -abpcrawler           Start a crawl. Must specify both an input and\n" +
  "                        an output.\n" +
  "  -input_file <path>    Use <path> as input file from which to compile\n" +
  "                        instructions for the crawl.\n" +
  "  -output_dir <path>    Use <path> as output directory to contain a\n" +
  "                        file of crawl results.\n" +
  "  -output_base <name>   Use <name> as the base name for a file of crawl\n" +
  "                        results. Optional. Default='crawl_results'.\n" +
  "  -max_tabs <N>         Maximum number of tabs for simultananeous\n" +
  "                        loading of target sites.\n";

/**
 * The actual handler.
 *
 * @param {nsICommandLine} command_line
 */
Command_Line.handle = function( command_line )
{
  Cu.reportError( "Handler: abpcrawler" );
  dump( "Command line handler: abpcrawler\n" );

  if ( !command_line.handleFlag( "abpcrawler", false ) )
  {
    /*
     * There's no '--abpcrawler' option on the command line. As a result we don't try to interpret any other
     * command line flags.
     */
    return;
  }
  /*
   * The '--abpcrawler' argument indicates that this invocation is designated as a crawl session. As a result,
   * we don't perform the default action, which is opening the start page in the browser for interactive use.
   */
  command_line.preventDefault = true;

  //Cu.reportError( "Found option --abpcrawler" );
  //dump( "Found option --abpcrawler" );
};

exports.Command_Line = Command_Line;
try
{
  Command_Line.init();
}
catch ( e )
{
  dump( "command_line.js: init(): " + e.message );
}
