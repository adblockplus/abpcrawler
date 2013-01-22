/**
 * @fileOverview Instructions are the units of effort for the crawler. This file provides iterators for instructions
 * that the main crawler loop will then execute.
 */

let {Logger} = require( "logger" );

function abprequire( module )
{
    let result = {};
    result.wrappedJSObject = result;
    Services.obs.notifyObservers( result, "adblockplus-require", module );
    return result.exports;
}
let {Policy} = abprequire( "contentPolicy" );

var Instruction = exports.Instruction = {};

// Is there a display log that watching log output?
Instruction.watching = false;
Instruction.log = null;

Instruction.configure_log = function( display )
{
    Instruction.watching = true;
    Instruction.display = display;
};

/**
 * Notice from the display log to us whether or not they would be watching our log output.
 * <p/>
 * If they're not watching, we can feel free not to send them anything.
 * @param {boolean} watching
 *      True iff the display log is watching for log output.
 */
Instruction.notice_watching = function( watching )
{
    Instruction.watching = watching;
};

Instruction.display_log = function( message )
{
    if ( Instruction.watching && Instruction.display )
    {
        Instruction.display.log( message );
    }
};

Instruction.display_log_trimmed = function( message )
{
    Instruction.display_log( message.substring( 0, message.length - 1 ) );
};

/**
 * The most basic instruction list uses the default processor, takes a fixed array of URL's to browse, and stores
 * everything in a single storage facility.
 *
 * @param {Array} browse_list
 * @param storage
 * @param format
 */
Instruction.basic = function( browse_list, storage, format )
{
    if ( !storage )
    {
        storage = Instruction.null_storage;
    }
    let n = browse_list.length;
    for ( let j = 0 ; j < n ; ++j )
    {
        yield new Default_Instruction( browse_list[j], storage, format );
    }
};

Instruction.null_storage =
{
    init: function()
    {
    },

    write: function()
    {
    },

    toString: function()
    {
        return "bit bucket";
    },

    to_JSON_value: function()
    {
        return "\"bit bucket\"";
    },

    toJSON: function()
    {
        return "bit bucket";
    }
};

/**
 * Instruction base class. Implements a single to_JSON_value() function, which should suffice for all specific instruction
 * types.
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

    /**
     * The JSON value for this operation.
     * <p/>
     * Must move this to the definition of the default operation, when that gets written.
     * @return {String}
     */
    this.operation.to_JSON_value = function()
    {
        return "\"default\"";
    };
    this.operation.toJSON = function()
    {
        return "default";
    };

    this.observations = [];

    this.log = new Logger( "Instruction_class" ).make_log();
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

    Instruction.display_log( "        -" );
    Instruction.display_log_trimmed( observation.to_YAML_value( 3 ) );
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

    Instruction.display_log( "-" );
    Instruction.display_log( "    time-start: " + this.time_start );
    Instruction.display_log_trimmed( this.to_YAML_value( 1 ) );
    Instruction.display_log( "    observations:" );
};

/**
 * Action at start of executing instruction. Run immediately before the tab is loaded.
 * <p/>
 * Framework function for the observation system.
 */
Instruction_class.prototype.end = function()
{
    this.time_finish = Logger.timestamp();

    Instruction.display_log( "    time-finish: " + this.time_finish );
    Instruction.display_log( "    JSON: " + JSON.stringify( this ) );
    this.log( "end " + this.time_finish );
};

//noinspection JSUnusedGlobalSymbols
Instruction_class.prototype.toJSON = function()
{
    return {
        instruction: { target: this.target, operation: this.operation },
        observations: this.observations,
        time_start: this.time_start,
        time_finish: this.time_finish
    };
};

function tab( indent )
{
    var s = "";
    for ( let i = indent ; i > 0 ; --i )
        s += "    ";
    return s;
}

Instruction_class.prototype.to_YAML_value = function( indent )
{
    let i = indent;
    var s = tab( i ) + "instruction:\n";
    ++i;
    s += tab( i ) + "target: " + this.target.toString() + "\n";
    s += tab( i ) + "operation: default\n";
    s += tab( i ) + "storage: " + this.storage.toString() + "\n";
    return s;
};

/**
 * The default instruction type.
 * @param {String} target
 * @param {*} storage
 * @constructor
 * @param format
 */
Default_Instruction = function( target, storage, format )
{
    this.target = target;
    this.storage = storage;
    this.format = format;
};
Default_Instruction.prototype = new Instruction_class();

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
        for ( i = 0 ; i < windows.length ; ++i )
        {
            this.window_locations.push( windows[i].location.href );
        }
    } else {
        // Figure out something
    }
};

Observation.prototype.to_YAML_value = function( indent )
{
    var s = tab( indent ) + "location: " + this.location + "\n";
    s += tab( indent ) + "filtered: " + this.filtered + "\n";
    s += tab( indent ) + "content_type: " + this.content_description + "\n";
    if ( this.entries.length == 1 )
    {
        s += tab( indent ) + "filter: " + this.filter + "\n";
        s += tab( indent ) + "windows:\n";
        for ( let i = 0 ; i < this.window_locations.length ; ++i )
        {
            s += tab( indent + 1 ) + "- " + this.window_locations[i] + "\n";
        }
    }
    else
    {
        s += tab( indent ) + "entries: NOT EXACTLY ONE\n";
    }
    return s;
};

//noinspection JSUnusedGlobalSymbols
Observation.prototype.toJSON = function()
{
    return {
        location: this.location,
        filtered: this.filtered,
        content_type: this.content_description,
        filter: (this.entries.length == 1) ? this.entries[0].entry.filter.text : undefined,
        windows: this.window_locations
    };
};

exports.Observation = Observation;
