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

/**
 * The most basic instruction list uses the default processor, takes a fixed array of URL's to browse, and stores
 * everything in a single storage facility.
 *
 * @param {Array} browse_list
 * @param storage
 */
Instruction.basic = function( browse_list, storage )
{
    if ( !storage )
    {
        storage = Instruction.null_storage;
    }
    let n = browse_list.length;
    for ( let j = 0 ; j < n ; ++j )
    {
        yield new Default_Instruction( browse_list[j], storage );
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

    this.observations = [];

    this.log = new Logger( "Instruction_class" ).make_log();
};

/**
 * Represent the instruction as a JSON object. This function extracts only the data that matters for an instruction and
 * avoids extraneous data as well as function members.
 * <p/>
 * DEFECT: The browse site needs to be checked that all quote marks and backslashes are quoted correctly. Putting
 * quote marks around the value of toString() won't always work.
 */
Instruction_class.prototype.to_JSON_value = function()
{
    return "{ target: \"" + this.target.toString()
        + "\", operation: " + this.operation.to_JSON_value()
        + ", storage: " + this.storage.to_JSON_value() + " }";
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

Instruction_class.prototype.start = function()
{
    this.time_start = Logger.timestamp();
};

Instruction_class.prototype.end = function()
{
    this.time_finish = Logger.timestamp();
    this.log( "end " + Logger.timestamp() );
};

/**
 * The default instruction type.
 * @param {String} target
 * @param {*} storage
 * @constructor
 */
Default_Instruction = function( target, storage )
{
    this.target = target;
    this.storage = storage;
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
};

Observation.prototype.to_YAML_value = function( indent )
{
    var s = tab( indent ) + "location: " + this.location + "\n";
    s += tab( indent ) + "filtered: " + this.filtered + "\n";
    s += tab( indent ) + "content_type: " + this.content_description + "\n";
    if ( this.entries.length < 2 )
    {
        let entry = this.entries[0].entry;
        s += tab( indent ) + "filter: " + entry.filter.text + "\n";
    }
    else
    {
        s += tab( indent ) + "entries: MORE THAN ONE\n";
    }
    return s;
};
exports.Observation = Observation;
