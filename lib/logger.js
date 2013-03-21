/**
 * Logging service. This is not the log function itself, but rather provide a factory for making such.
 *
 * @param {String} module
 *      The name identifying the main module.
 * @constructor
 */
var Logger = function( module )
{
  /**
   * The module name
   * @type {String}
   */
  this.module = module;

  /**
   * Global flag to suppress all output.
   * @type {boolean}
   * @private
   */
  this._suppressed = false;

  /**
   * The console service used to report messages. This instance is used to get access to logMessage, which
   * we use as a static function.
   */
  this.console_service =
    Components.classes["@mozilla.org/consoleservice;1"].getService( Components.interfaces.nsIConsoleService );
};
exports.Logger = Logger;

Logger.prototype.suppress = function( suppressed )
{
  this._suppressed = suppressed;
};

/**
 * Create an ordinary log function with a consistent naming convention.
 *
 * @param {String} [submodule]
 *      The name identifying some piece of the main module.
 * @return {Function}
 *      A two-argument function with the ordinary signature for a log message.
 */
Logger.prototype.make_log = function( submodule )
{
  var prefix = this.module;
  if ( submodule && submodule.length > 0 )
  {
    prefix += "/" + submodule;
  }
  prefix += ": ";
  return this.log.bind( this, prefix );
};

/**
 * Display a log message whose location is reported as the source line of the caller, rather than some line within
 * the log function itself.
 * <p/>
 * Note that this function would ordinarily be called from a function returned from make_log(), which computes the
 * prefix argument. This is not a hard requirement, but rather a recommended practice.
 *
 * @param {String} prefix
 *      String to be prepended before the message argument.
 * @param {String} message
 *      The main error message.
 * @param {Boolean} [allow]
 *      If present and false, suppresses the message. Allows disabling a log message by arbitrary category,
 *      as implemented by the caller.
 */
Logger.prototype.log = function( prefix, message, allow )
{
  if ( ( arguments.length >= 3 && !allow ) || this._suppressed )
  {
    // Assert we have an explicit argument to disallow the message
    return;
  }
  var error_report =
    Components.classes["@mozilla.org/scripterror;1"].createInstance( Components.interfaces.nsIScriptError );
  var caller = Components.stack.caller;

  /*
   * Remove the beginning of any filename value that contains a text arrow. This notation is used to indicate the
   * complete link path by which the source came into context. While complete, it makes the links presented in
   * the error console non-clickable.
   */
  var filename = caller.filename;
  var n = filename.lastIndexOf( " -> " );
  if ( n > -1 )
  {
    filename = filename.substr( n + 4 );
  }

  error_report.init( prefix + message, filename, null, caller.lineNumber, null, 1, "javascript" );
  this.console_service.logMessage( error_report );

  /*
   * This line was used during development to see just what was in the scripterror object. Unfortunately, making a
   * string message that exactly matches this format does not display as an error. In particular there is no
   * clickable link displayed. Thus the best we can do is to display a warning with a link, rather than an ordinary
   * console message, which doesn't display a clickable location.
   */
  //Cu.reportError( "ScriptError=" + scriptError.toString() );
};

/**
 * Emit a stack trace to the log.
 */
Logger.prototype.stack_trace = function()
{
  var e = new Error();
  this.log( "", e.stack );
};


function pad2( n )
{
  var s = String( n );
  if ( n < 10 )
    s = "0" + s;
  return s;
}

function pad3( n )
{
  var s = String( n );
  if ( n < 100 )
  {
    s = "0" + s;
    if ( n < 10 )
      s = "0" + s;
  }
  return s;
}

Logger.timestamp = function()
{
  let date = new Date();
  return date.getUTCFullYear() + "-" + pad2( date.getUTCMonth() + 1 ) + "-" + pad2( date.getUTCDate() )
    + " " + pad2( date.getUTCHours() ) + ":" + pad2( date.getUTCMinutes() ) + ":" + pad2( date.getUTCSeconds() )
    + "." + pad3( date.getUTCMilliseconds() );
};
