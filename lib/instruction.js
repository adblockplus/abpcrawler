/**
 * @fileOverview Instructions are the units of effort for the crawler. This file provides iterators for instructions
 * that the main crawler loop will then execute.
 */

var Instruction = exports.Instruction = {};

var {default_operation} = require( "crawler" );

/**
 * The most basic instruction list uses the default processor, takes a fixed array of URL's to browse, and stores
 * everything in a single storage facility.
 *
 * @param {Array} browse_list
 * @param storage
 */
Instruction.basic = function( browse_list, storage )
{
    if ( ! storage ) {
        storage = Instruction.null_storage;
    }
    let n = browse_list.length;
    for ( let j = 0 ; j < n ; ++j )
    {
        yield { browse: browse_list[j], storage: storage }
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
        return "bit bucket"
    }
};

/**
 * Instruction base class. Implements a single toJSON() function, which should suffice for all specific instruction
 * types.
 *
 * @constructor
 */
var Instruction_class = function()
{
    /**
     * The only universal aspect to crawling is that we are crawling other people's web sites. This field is the URL for
     * a site.
     *
     * @type {String}
     */
    this.browse = null;

    /**
     * The operation to perform at the browse site.
     */
    this.operation = default_operation;

    /**
     * Will move this to the definition.
     *
     * @return {String}
     */
    this.operation.toJSON = function()
    {
        return "{ operation: \"default\" }";
    };

    /**
     *
     */
};

/**
 * Represent the instruction as a JSON object. This function extracts only the data that matters for an instruction and
 * avoids extraneous data as well as function members.
 * <p/>
 * DEFECT: The browse site needs to be checked that all quote marks and backslashes are quoted correctly. Putting
 * quote marks around the value of toString() won't always work.
 */
Instruction_class.prototype.toJSON = function()
{
    return "{ browse: \"" + this.browse.toString()
        + "\", operation: " + this.operation.toJSON()
        + "storage: " + this.storage.toJSON() + " }";
};

