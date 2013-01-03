var Logger = exports.Logger = function( module )
{
    this.module = module;

    this.console_service =
        Components.classes["@mozilla.org/consoleservice;1"].getService( Components.interfaces.nsIConsoleService );
};

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

Logger.prototype.log = function( prefix, message, allow )
{
    if ( arguments.length >= 3 && !allow )
    {
        // Assert we have an explicit argument to disallow the message
        return;
    }

    var scriptError =
        Components.classes["@mozilla.org/scripterror;1"].createInstance( Components.interfaces.nsIScriptError );

    var stack = Components.stack;
    var caller = stack.caller;
    scriptError.init( prefix + message, caller.filename, null, caller.lineNumber, null, 1, "javascript" );
    //Cu.reportError( "ScriptError=" + scriptError.toString() );
    this.console_service.logMessage( scriptError );
    //Cu.reportError( prefix + message );
};
