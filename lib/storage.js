let {YAML} = require( "encoding" );
let {Logger} = require( "logger" );

Cu.import( "resource://gre/modules/FileUtils.jsm" );

//-------------------------------------------------------
// Storage_class
//-------------------------------------------------------
/**
 * Base class for particular storage mechanisms. Implements all storage framework methods. Necessary methods have
 * implementations that throw if not overridden. Optional methods have no-op implementations.
 * @constructor
 */
var Storage_class = function()
{
    this.marker = "instance of Storage_class";
};

/**
 * Return a string of the form "[object ...]" like the built-in types do.
 * <p/>
 * Mandatory framework function.
 */
Storage_class.prototype.toJSON = function()
{
    throw new Error( "Subclass of Storage_class did not implement 'toJSON()'." );
};

/**
 * Called when the crawl first begins, before any targets have been loaded.
 * <p/>
 * Optional framework function.
 */
Storage_class.prototype.begin = function( instruction )
{
};

/**
 * Called at each node, with the observation instance for that node.
 * <p/>
 * Optional framework function.
 */
Storage_class.prototype.node = function( observation )
{
};

/**
 * Called when the crawl ends, whether normally or abnormally.
 * <p/>
 * Optional framework function.
 */
Storage_class.prototype.end = function()
{
};

//-------------------------------------------------------
// Storage.Bit_Bucket
//-------------------------------------------------------

var Bit_Bucket = function()
{
};
Bit_Bucket.prototype = new Storage_class();

/**
 * The only way that this differs from the do-nothing base class is that we provide a name.
 */
Bit_Bucket.prototype.name = function()
{
    return "bit bucket";
};

//-------------------------------------------------------
// Storage.Multiple
//-------------------------------------------------------
/**
 * Combine one or more Storage_class objects into a single one. This is ordinarily used for logging activity to the
 * screen during the run. It also allows enables summary statistics to be gathered simultaneously with a crawl to
 * support filter list construction.
 * @constructor
 */
var Multiple = function()
{
};
Multiple.prototype = new Storage_class();

//-------------------------------------------------------
// Storage.Display_Log
//-------------------------------------------------------
/**
 * A display log in the crawler UI, presumably a simple textbox. Used to monitor progress during a crawl, if desired.
 * @constructor
 * @param [display]
 *      A display object from the crawler UI.
 */
var Display_Log = function( display )
{
    // TEMPORARY. Uses the global display object until such time as we get the initialization chain under control.
    this.display = display ? display : Display_Log.display;
};
Display_Log.prototype = new Storage_class();

Display_Log.logger = new Logger( "Display_Log" );

/**
 * @override
 */
Display_Log.prototype.toJSON = function()
{
    return "Display_Log";
};

/**
 * @override
 */
Display_Log.prototype.begin = function( instruction )
{
    this.display.log( "STORAGE -" );
    this.display.log( "STORAGE     time-start: " + instruction.time_start );
    this.display.log( "STORAGE     observations:" );
};

/**
 * Called at each node, with the observation instance for that node.
 * <p/>
 * Optional framework function.
 * @override
 */
Display_Log.prototype.node = function( observation )
{
};

/**
 * Called when the crawl ends, whether normally or abnormally.
 * <p/>
 * Optional framework function.
 * @override
 */
Display_Log.prototype.end = function()
{
};

/**
 * A hack for initializing the console log during development.
 */
Display_Log.init = function( display )
{
    Display_Log.display = display;
};

//-------------------------------------------------------
// Storage
//-------------------------------------------------------
/**
 * Export variable for this module. There's no single class named "Storage" as such.
 */
exports.Storage = {
    Bit_Bucket: Bit_Bucket,
    Multiple: Multiple,
    Display_Log: Display_Log
};