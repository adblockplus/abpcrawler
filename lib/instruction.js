/**
 * @fileOverview Instructions are the units of effort for the crawler. This file provides iterators for instructions
 * that the main crawler loop will then execute.
 */

let {Logger} = require( "logger" );
let {Storage} = require( "storage" );
let {Encoding} = require( "encoding" );

function abprequire( module )
{
    let result = {};
    result.wrappedJSObject = result;
    Services.obs.notifyObservers( result, "adblockplus-require", module );
    return result.exports;
}
let {Policy} = abprequire( "contentPolicy" );

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
Instruction_class.prototype.begin = function( encoder )
{
    var log = this.logger.make_log( "begin" );

    this.time_start = Logger.timestamp();
};

/**
 * Action at start of executing instruction. Run immediately before the tab is loaded.
 * <p/>
 * Framework function for the observation system.
 */
Instruction_class.prototype.end = function( encoder )
{
    this.time_finish = Logger.timestamp();
    this.termination = "completed";      // May alter to "cancelled" or "aborted".

    encoder.sequence_send( this );
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
// Instruction.basic
//-------------------------------------------------------
/**
 * The most basic instruction list uses the default processor, takes a fixed array of URL's to browse, and stores
 * everything in a single storage facility.
 * <p/>
 * This is the prototype example of an instruction generator. More generally, a crawl specification (as source code)
 * must become a generator as illustrated here.
 *
 * @param {String} name
 * @param {Array} browse_list
 */
Instruction_Set.Basic = function( name, browse_list )
{
    this.name = name;
    this.browse_list = browse_list;
};
Instruction_Set.Basic.prototype = new Instruction_Set_class();

Instruction_Set.Basic.prototype.__encoding__ =
    Encoding.as_object( [Encoding.immediate_fields( ["name"] )] );

Instruction_Set.Basic.prototype.generator = function()
{
    let n = this.browse_list.length;
    for ( let j = 0 ; j < n ; ++j )
    {
        yield new Default_Instruction( this.browse_list[j] );
    }
};

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
        content_type: this.content_description,
        filter: (this.entries.length == 1) ? this.entries[0].entry.filter.text : undefined,
        window_locations: this.window_locations
    };
};

exports.Observation = Observation;


function tab( indent )
{
    var s = "";
    for ( let i = indent ; i > 0 ; --i )
        s += "    ";
    return s;
}

var YAML = {};
YAML.array_mark = "- ";
YAML.array_extra = "  ";

YAML.stringify = function( object )
{
    return YAML.write( object, 0, "", "" );
};

YAML.log = (new Logger( "YAML/write" )).make_log();

/**
 * Recursive writer.
 * <p/>
 * The basic recursion principle is that the caller is responsible for indentation of the first line (perhaps the only
 * one) and the callee is responsible for all internal indentation. This is modified to account for the difference
 * between primitives and aggregates. The 'extra' is added before aggregates, but not before primitives.
 *
 * @param value
 * @param indent
 * @param primitive_extra
 * @param aggregate_extra
 */
YAML.write = function( value, indent, primitive_extra, aggregate_extra )
{
    var s = "";
    switch ( typeof value )
    {
        case "string":
        case "number":
            s += primitive_extra + value + "\n";
            break;
        case "boolean":
            s += primitive_extra + ( value ? "true" : "false" ) + "\n";
            break;
        case "object":
            if ( !value )
                break;
            let t = Object.prototype.toString.call( value );
            switch ( t )
            {
                case "[object Array]":
                    // Assert we have an array
                    for ( let i = 0 ; i < value.length ; ++i )
                    {
                        if ( i == 0 )
                        {
                            s += aggregate_extra;
                        }
                        else
                        {
                            s += tab( indent );
                        }
                        s += YAML.array_mark + YAML.write( value[ i ], indent + 1, "", YAML.array_extra );
                    }
                    break;
                case "[object Object]":
                    // Assert we have a generic object
                    if ( "toJSON" in value )
                    {
                        value = value.toJSON();

                    }
                    try
                    {
                        var keys = Object.keys( value );
                    }
                    catch ( e )
                    {
                        // Sometimes an object is not an object. Really.
                        s += primitive_extra + value.toString() + "\n";
                        break;
                    }
                    for ( let i = 0 ; i < keys.length ; ++i )
                    {
                        if ( i == 0 )
                        {
                            s += aggregate_extra;
                        }
                        else
                        {
                            s += tab( indent );
                        }
                        s += keys[ i ] + ":" + YAML.write( value[ keys[ i ] ], indent + 1, " ", "\n" + tab( indent + 1 ) );
                    }
                    break;
                default:
                    s += primitive_extra + value.toString() + "\n";
            }
            break;
        default:
            break;
    }
    return s;
};
