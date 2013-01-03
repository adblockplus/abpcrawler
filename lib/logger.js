var Logger = exports.Logger = function( module )
{
    this.module = module;
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

    Cu.reportError( prefix + message );
};
