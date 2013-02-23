let {Encoding} = require( "encoding" );
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
 * Mandatory framework function.
 */
Storage_class.prototype.write = function()
{
    throw new Error( "Subclass of Storage_class did not implement 'write()'." );
};

/**
 * Called when the crawl ends, whether normally or abnormally.
 */
Storage_class.prototype.close = function()
{
};

Storage_class.prototype.writer = function()
{
    return this.write.bind( this );
};

//-------------------------------------------------------
// Storage.Local_File
//-------------------------------------------------------
/**
 * Storage to the local file system.
 * <p>
 * This class writes directly to the given file. It does not write to a temporary file first, say, using 'createUnique',
 * and then renaming it.
 *
 * @param {nsIFile} file
 *     File object to which to write.
 * @constructor
 */
var Local_File = function( file )
{
    /**
     * @type {nsIFile}
     */
    this.file = file;

    this.output = FileUtils.openSafeFileOutputStream( file );
    this.converter_output = Cc["@mozilla.org/intl/converter-output-stream;1"]
        .createInstance( Ci.nsIConverterOutputStream );
    this.converter_output.init( this.output, "UTF-8", 0, 0 );
};
Local_File.prototype = new Storage_class();

Local_File.prototype.toJSON = function()
{
    return "local file " + this.file.path;
};

Local_File.prototype.close = function()
{
    this.converter_output.flush();
    FileUtils.closeSafeFileOutputStream( this.output );
};

Local_File.prototype.write = function( s )
{
    this.converter_output.writeString( s );
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
Bit_Bucket.prototype.toJSON = function()
{
    return "bit bucket";
};
Bit_Bucket.prototype.write = function()
{
};

//-------------------------------------------------------
// Storage.Multiple
//-------------------------------------------------------
/**
 * Combine one or more Storage_class objects into a single one. This is ordinarily used for logging activity to the
 * screen during the run. It also allows enables summary statistics to be gathered simultaneously with a crawl to
 * support filter list construction.
 * @constructor
 * @param {Array} stores
 *      An array of Storage_class objects.
 * @param {boolean} [omit_first]
 *      Suppress first element in JSON display.
 */
var Multiple = function( stores, omit_first )
{
    this.stores = stores;
    this.omit_first = omit_first;
};
Multiple.prototype = new Storage_class();

/**
 * @override
 */
Multiple.prototype.toJSON = function()
{
    if ( this.omit_first && this.stores.length == 2 )
    {
        /*
         * Special case: Pretend we're not here.
         */
        return this.stores[ 1 ].toJSON();
    }
    var s = "Multiple[";
    var first = (this.omit_first) ? 1 : 0;
    if ( this.first < this.stores.length )
    {
        for ( let i = first ; i < this.stores.length ; ++i )
        {
            if ( i > first ) s += ",";
            s += " " + JSON.stringify( this.stores[i] );
        }
        s += " ";
    }
    s += "]";
    return s;
};

/**
 * @override
 */
Multiple.prototype.write = function( s )
{
    for ( let i = 0 ; i < this.stores.length ; ++i )
    {
        this.stores[i].write( s );
    }
};

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
    this.display = display;
};
Display_Log.prototype = new Storage_class();

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
Display_Log.prototype.write = function( s )
{
    this.display.write( s );
};

//-------------------------------------------------------
// Storage
//-------------------------------------------------------
/**
 * Export variable for this module. There's no single class named "Storage" as such.
 */
exports.Storage = {
    Local_File: Local_File,
    Bit_Bucket: Bit_Bucket,
    Multiple: Multiple,
    Display_Log: Display_Log
};