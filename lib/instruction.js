/**
 * @fileOverview Instructions are the units of effort for the crawler. This file provides iterators for instructions
 * that the main crawler loop will then execute.
 */

let {Logger} = require( "logger" );
let {Storage} = require( "storage" );
let {Encoding} = require( "encoding" );
let {YAML, YamlParseException} = require( "yaml" );

function abprequire( module )
{
    let result = {};
    result.wrappedJSObject = result;
    Services.obs.notifyObservers( result, "adblockplus-require", module );
    return result.exports;
}
let {Policy} = abprequire( "contentPolicy" );

//-------------------------------------------------------
// Input
//-------------------------------------------------------
/**
 * Base class for retrieving source code for crawl instructions. Implementations include fixed string and local file.
 *
 * @property {Object} value
 * @property {string} text
 * @constructor
 */
var Input_class = function()
{
};

/**
 * Load the input into memory and parse it.
 * <p/>
 * Postcondition: 'this.value' has a parsed copy of the input.
 */
Input_class.prototype.load = function()
{
    throw new Error( "'Input_class.load' is abstract." );
};

/**
 * Reset the internal storage members of this object. Use to release memory and assist the garbage collector.
 */
Input_class.prototype.reset = function()
{
    throw new Error( "'Input_class.reset' is abstract." );
};

//----------------------------------
// Input_String
//----------------------------------
/**
 * Use a fixed text for the input.
 *
 * @param text
 * @constructor
 * @extends {Input_class}
 */
var Input_String = function( text )
{
    this.text = text;
    this.value = null;
};
Input_String.prototype = new Input_class();

/**
 * Parse the input string.
 */
Input_String.prototype.load = function()
{
    this.value = YAML.parse( this.text );
};

/**
 * Reset all the internal members.
 */
Input_String.prototype.reset = function()
{
    this.text = null;
    this.value = null;
};

//----------------------------------
// Input_File
//----------------------------------
/**
 *
 * @param {nsIFile} file
 * @constructor
 */
var Input_File = function( file )
{
    this.file = file;
};
Input_File.prototype = new Input_class();

Input_File.prototype.load = function()
{
    var data = "";
    var fstream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance( Ci.nsIFileInputStream );
    var cstream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance( Ci.nsIConverterInputStream );
    fstream.init( this.file, -1, 0, 0 );
    cstream.init( fstream, "UTF-8", 0, 0 );
    let str = {};
    let read = 0;
    do {
        read = cstream.readString( 0xffffffff, str ); // read as much as we can and put it in str.value
        data += str.value;
    } while ( read != 0 );
    cstream.close();
    this.value = YAML.parse( data );
};

Input_File.prototype.reset = function()
{
    this.file = null;
    this.value = null;
};

//----------------------------------
// exports for Input
//----------------------------------
exports.Input_String = Input_String;
exports.Input_File = Input_File;

//-------------------------------------------------------
// Instruction
//-------------------------------------------------------

var Instruction = exports.Instruction = {};

/**
 * Instruction base class.
 *
 * @constructor
 */
var Instruction_class = function()
{
    /**
     * The only universal aspect to crawling is that we are crawling other people's web sites. This field is the URL for
     * a site.
     * @type {String}
     */
    this.target = null;

    /**
     * The operation to perform at the browse site.
     */
    this.operation = {};

    this.operation.toJSON = function()
    {
        return "default";
    };

    this.logger = new Logger( "Instruction_class" );
    this.log = this.logger.make_log();
};

/**
 * Predicate about whether this instruction observes all nodes or only filtered ones.
 * <p/>
 * Framework function for the observation system. Intended to be overridden by subclasses.
 * @return {boolean}
 */
Instruction_class.prototype.observing_all_nodes = function()
{
    return false;
};

/**
 * Record an observation as the crawler sees it.
 * <p/>
 * Framework function for the observation system.
 * @param observation
 */
Instruction_class.prototype.observe_node = function( observation )
{
    this.observations.push( observation );
};

/**
 * Action at start of executing instruction. Run immediately before the tab is loaded.
 * <p/>
 * Framework function for the observation system.
 * <p/>
 * This function currently has no arguments. The only one that might be relevant is the 'Browser_Tab' instance. It was
 * not chosen as an argument because there's no apparent reason for it. Altering the load behavior should be done by
 * specifying a subclass of 'Browser_Tab' in the instruction.
 */
Instruction_class.prototype.begin = function()
{
    this.time_start = Logger.timestamp();
};

/**
 * Action at start of executing instruction. Run immediately before the tab is loaded.
 * <p/>
 * Framework function for the observation system.
 */
Instruction_class.prototype.end = function()
{
    this.time_finish = Logger.timestamp();
    this.termination = "completed";      // May alter to "cancelled" or "aborted".

    /*
     * Sort the observation array and merge to remove duplicates.
     */
    this.observations.sort( Observation.cmp );
    if ( this.observations.length >= 2 )
    {
        var merged = [];
        merged.push( this.observations[0] );
        this.observations.reduce( function( previous, current )
        {
            if ( !previous.equals( current ) )
            {
                merged.push( current );
            }
            return current;
        } );
        this.observations = merged;
    }
};

//noinspection JSUnusedGlobalSymbols
Instruction_class.prototype.toJSON = function()
{
    return {
        target: this.target,
        operation: this.operation,
        time_start: this.time_start,
        observations: this.observations,
        time_finish: this.time_finish
    };
};

//-------------------------------------------------------
// Instruction_Set
//-------------------------------------------------------
/**
 * As-yet unused base class for instruction sets
 * @constructor
 */
var Instruction_Set_class = function()
{
};
Instruction_Set_class.prototype.generator = function()
{
    throw new Error( "Must override 'generator' when deriving from Instruction_Set_class" );
};

var Instruction_Set = {};
exports.Instruction_Set = Instruction_Set;

//-------------------------------------------------------
// Instruction_Set.Parsed
//-------------------------------------------------------

/**
 * An instruction set constructed from a parsed YAML document.
 *
 * @param {Input_class} input
 * @constructor
 */
Instruction_Set.Parsed = function( input )
{
    try
    {
        input.load();
        this.source = input.value;
    }
    finally
    {
        input.reset();
    }

    this.name = this.source.name;
    this.instructions = [];
    let target = this.source.target;
    let n = target.length;
    for ( let j = 0 ; j < n ; ++j )
    {
        this.instructions.push( new Default_Instruction( target[ j ] ) );
    }
};
Instruction_Set.Parsed.prototype = new Instruction_Set_class();

Instruction_Set.Parsed.prototype.generator = function()
{
    let n = this.instructions.length;
    for ( let j = 0 ; j < n ; ++j )
    {
        yield this.instructions[ j ];
    }
};

Instruction_Set.Parsed.prototype.toJSON = function()
{
    return { name: this.name };
};

//-------------------------------------------------------
// Default_Instruction
//-------------------------------------------------------
/**
 * The default instruction type.
 * @param {String} target
 * @constructor
 */
Default_Instruction = function( target )
{
    this.target = target;

    /**
     * Observations array
     * @type {Array}
     */
    this.observations = [];
};
Default_Instruction.prototype = new Instruction_class();

//-------------------------------------------------------
// Observation
//-------------------------------------------------------
/**
 *
 * @param filtered
 * @param content_type
 * @param location
 * @param entries
 * @constructor
 */
var Observation = function( filtered, content_type, location, entries )
{
    this.filtered = filtered;
    this.content_description = Policy.typeDescr[content_type];
    this.location = location;
    this.entries = entries;
    if ( this.entries.length == 1 )
    {
        let x = this.entries[0];
        this.filter = x.entry.filter.text;
        let windows = x.windows;
        this.window_locations = [];
        // Loop is explicit to ensure array order.
        for ( let i = 0 ; i < windows.length ; ++i )
        {
            this.window_locations.push( windows[i].location.href );
        }
    }
    else
    {
        // Figure out something
    }
};

//noinspection JSUnusedGlobalSymbols
Observation.prototype.toJSON = function()
{
    return {
        location: this.location,
        filtered: this.filtered,
        content_description: this.content_description,
        filter: (this.entries.length == 1) ? this.entries[0].entry.filter.text : undefined,
        window_locations: this.window_locations
    };
};

/**
 * Comparison function
 *
 * @param {Observation} x
 * @return {number}
 */
Observation.prototype.compare = function( x )
{
    /*
     * 1. Sort filtered elements before non-filtered ones.
     */
    var a = ( this.filtered ? -1 : 0 ) + ( x.filtered ? 1 : 0 );
    if ( a != 0 ) return a;
    /*
     * 2. Sort by location, a URL string.
     */
    if ( this.location < x.location ) return -1;
    if ( this.location > x.location ) return 1;
    /*
     * 3. Sort by filter. Because of the way that entries are collected, we check the entry lists as a whole.
     */
    var n = Math.min( this.entries.length, x.entries.length );
    for ( let j = 0 ; j < n ; ++j )
    {
        let s1 = this.entries[ j ];
        let s2 = x.entries[ j ];
        if ( s1 < s2 ) return -1;
        if ( s1 > s2 ) return 1;
    }
    // Assert all entries are equal up to their common length
    // The longer element is sorted later
    a = this.entries.length - x.entries.length;
    if ( a != 0 ) return a;
    /*
     * 4. Sort by window chain.
     */
    n = Math.min( this.window_locations.length, x.window_locations.length );
    for ( let j = 0 ; j < n ; ++j )
    {
        let s1 = this.window_locations[ j ];
        let s2 = x.window_locations[ j ];
        if ( s1 < s2 ) return -1;
        if ( s1 > s2 ) return 1;
    }
    return this.window_locations.length - x.window_locations.length;
};

/**
 * Equality test.
 * @param x
 */
Observation.prototype.equals = function( x )
{
    return this.compare( x ) == 0;
};

/**
 *
 * @param {Observation} a
 * @param {Observation} b
 * @return {number}
 */
Observation.cmp = function( a, b )
{
    return a.compare( b );
};

exports.Observation = Observation;
