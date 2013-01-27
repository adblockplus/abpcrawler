let {Logger} = require( "logger" );

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

//-------------------------------------------------------
// YAML_stream
//-------------------------------------------------------
/**
 * Stream output in YAML format.
 * @param {Function} sink
 *      Called with each string segment of the output in sequence.
 * @constructor
 */
var YAML_stream = function( sink )
{
    /**
     * Writer function.
     * @type {Function}
     */
    this.sink = sink;

    this.logger = new Logger( "YAML_stream" );

    /**
     * State machine stack.
     * @type {Array}
     */
    this.stack = [];

    /**
     * Input queue.
     * @type {Array}
     */
    this.input = [];

    this.endmark = null;

    this._writing = false;
};

YAML_stream.prototype.sequence_start = function()
{
    this._send_mark( Encoding.type.start );
};

YAML_stream.prototype.sequence_stop = function()
{
    this.logger.make_log( "sequence_stop" )( "" );
    this._send_mark( Encoding.type.stop );
};

YAML_stream.prototype._send_mark = function( mark )
{
    try
    { /*
     * We have to trigger the generator, which has yielded awaiting the next value. We set the endmark flag
     * as an out-of-band signal to the generator that it should ignore the yield value and substitute an end marker.
     */
        this.endmark = mark;
        this.generator.next();
    }
    catch ( e )
    {
        if ( e === StopIteration )
        // This is expected if it stops the last deferred sequence in the object.
            return;
        throw e;
    }
};

YAML_stream.prototype.sequence_send = function( value )
{
    this.generator.send( value );
};

YAML_stream.prototype.write = function( value, view )
{
    if ( this._writing )
        throw new Error( "Already writing" );
    this._writing = true;

    /*
     * Obtain the generator and bring it to its first yield statement. Because we put a frame on the stack before
     * instantiating the generator, the generator will immediately yield, waiting for a value.
     */
    this.push( view, 0, "", "", value );
    var g = this.machine();
    this.generator = g;
    try
    {
        g.next();
        return g;
    }
    catch ( e )
    {
        if ( e !== StopIteration ) throw e;
        return null;
    }
};

/**
 * Stack processing machine for a depth-first traversal of an object tree structure where some of the nodes may
 * be deferred streams.
 */
YAML_stream.prototype.machine = function()
{
    if ( this.endmark )
        throw new Error( "endmark must be false at machine start" );

    while ( this.stack_is_nonempty() )
    {
        /*
         * @type {{view: *, indent: number, primitive_extra: string, aggregate_extra: string, value: *}}
         */
        var context = this.top();
        if ( "view" in context )
        {
            var view = context.view;
        }
        if ( !view )
        {
            view = {};
        }

        var log = this.logger.make_log( "machine(" + this.stack.length + ")" );
        /*
         * Since there's an item on the stack, we need a value.
         */
        if ( "value" in context )
        {
            var value = context.value;
        }
        else
        {
            value = yield null;
            if ( this.endmark )
            {
                log( "Received mark = " + JSON.stringify( this.endmark )
                    + "\nold view = " + JSON.stringify( view ) );
                /*
                 * An endmark is a pseudovalue used to mark the end of a stream of indeterminate length. We map
                 * it to a view type that ignores the value.
                 */
                view = {type: this.endmark};
                this.endmark = null;
            }
        }

        if ( !("type" in view) )
        {
            // Determine the encoding.
            if ( value == null )
            {
                view.type = Encoding.type.null;
            }
            else if ( ( typeof value ) == "object" )
            {
                let t = Object.prototype.toString.call( value );
                switch ( t )
                {
                    case "[object Array]":
                        view.type = Encoding.type.array;
                        view.value_now = true;
                        break;
                    case "[object Object]":
                        view.type = Encoding.type.object;
                        try
                        {
                            var keys = Object.keys( value );
                        }
                        catch ( e )
                        {
                            // Sometimes an object is not an object. Really.
                            view.type = Encoding.type.primitive;
                            if ( value == null )
                            {
                                value = "null";
                            }
                            break;
                        }
                        view.seq = Encoding.immediate_fields( keys );
                        break;
                    default:
                        /*
                         * For example, [object Date]. They all have meaningful toString() implementations.
                         */
                        view.type = Encoding.type.primitive;
                        break;
                }
            }
            else
            {
                view.type = Encoding.type.primitive;
            }
        }

        log( "\n\tvalue = " + JSON.stringify( value )
            + "\n\tview = " + JSON.stringify( view ) );

        switch ( view.type.id )
        {
            case Encoding.type.null.id:
                this.sink( context.primitive_extra + "null\n" );
                this.pop();
                break;
            case Encoding.type.primitive.id:
                this.sink( context.primitive_extra + value.toString() + "\n" );
                this.pop();
                break;
            case Encoding.type.object.id:
                throw new Error( "Objects not implemented" );

                let recurring_extra = "\n" + tab( context.indent + 1 );
                for ( let i = 0 ; i < view.seq.length ; ++i )
                {
                    let field = view.seq[ i ];
                    let k = field.key;
                    this.sink( ( i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                    this.sink( k + ":" );
                    /*
                     * Create a recursive generator and start it with a dummy call to next(). Because of the initial yield
                     * statement at the beginning, the first call to next() can never throw StopIteration.
                     */
                    this.push( null, context.indent + 1, " ", recurring_extra );
                }
                break;
            case Encoding.type.array.id:
            {
                let b = "state" in context;
                if ( !b )
                {
                    context.state = { i: 0 };
                }
                if ( view.value_now )
                {
                    if ( context.state.i < value.length )
                    {
                        this.sink( YAML.array_mark );
                        this.sink( ( context.state.i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                        this.push(
                            view.element_view,
                            context.indent + 1, "", YAML.array_extra,
                            value[ context.state.i ]
                        );
                        ++context.state.i;
                    }
                    else
                    {
                        this.pop();
                    }
                    /*
                     * A zero-length array still needs a newline, since all values need one at the end of their output.
                     */
                    if ( context.state.i == 0 )
                        this.sink( "\n" );
                }
                else
                {
                    /*
                     * There's no 'value' argument in building the frame so that we obtain a deferred value in the
                     * next iteration.
                     *
                     * We compute a prefix so that we can defer its output until after we know we have a value for it
                     * to precede.
                     */
                    let prefix = YAML.array_mark
                        + ( ( context.state.i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                    this.push(
                        view.element_view,
                        context.indent + 1, prefix, prefix + YAML.array_extra
                    );
                    ++context.state.i;
                    /*
                     * If this was the first time we saw the array type, we need to push another frame onto the stack
                     * to ensure that the user calls sequence_start().
                     */
                    if ( !b )
                    {
                        this.push( {type: Encoding.type.start}, 0, "", "" );
                    }
                }
            }
                break;
            case Encoding.type.start.id:
                if ( "state" in context )
                {
                    throw new Error( "unexpected call to sequence_start()" );
                }
                else
                {
                    this.pop();
                    context.state = { i: 0 };
                }
                break;
            case Encoding.type.stop.id:
                log( "Processing end marker" );
                /*
                 * First call to pop() removes the end marker. The top of the stack is then the array frame. We deal
                 * with zero length arrays, then remove the array frame.
                 */
                this.pop();
                if ( this.top().state.i == 0 )
                    this.sink( "\n" );
                this.pop();
                break;
            default:
                this.sink( "\n" );
                break;
        }
    }
    log = this.logger.make_log( "machine(" + this.stack.length + ")" );
    log( "machine end" );
    this._writing = false;
};

/**
 *
 * @param {*} view
 * @param {number} indent
 * @param {string} primitive_extra
 * @param {string} aggregate_extra
 * @param {*} [value]
 */
YAML_stream.prototype.push = function( view, indent, primitive_extra, aggregate_extra, value )
{
    if ( this.stack.length > 100 )
        throw new Error( "stack overflow" );

    var x = {
        view: view,
        indent: indent,
        primitive_extra: primitive_extra,
        aggregate_extra: aggregate_extra,
        value: value
    };
    if ( arguments.length < 5 )
    {
        delete x.value;
    }
    this.stack.push( x );
};

YAML_stream.prototype.top = function()
{
    return this.stack[ this.stack.length - 1 ];
};

YAML_stream.prototype.pop = function()
{
    if ( this.stack.length == 0 )
        throw new Error( "Stack empty" );
    return this.stack.pop();
};

YAML_stream.prototype.stack_is_nonempty = function()
{
    return this.stack.length != 0;
};

//-------------------------------------------------------
// Encoding
//-------------------------------------------------------

/**
 * The export object for this module.
 */
var Encoding = { YAML: YAML, YAML_stream: YAML_stream };
Encoding.type = {
    /**
     * A primitive value or opaque object whose members are not separately output. Uses toString() to provide a value.
     */
    null: { id: 0, name: "null" },
    /**
     * A primitive value or opaque object whose members are not separately output. Uses toString() to provide a value.
     */
    primitive: { id: 1, name: "primitive" },
    /**
     * A transparent object whose members are each listed.
     */
    object: { id: 2, name: "object" },

    /**
     * An array object
     */
    array: { id: 3, name: "array" },
    /**
     * A start marker for the beginning of a deferred sequence
     */
    start: { id: 4, name: "start" },
    /**
     * A stop marker for the end of a deferred sequence
     */
    stop: { id: 5, name: "stop" }
};

Encoding.immediate_fields = function( keys )
{
    return keys.reduce( function( result, key )
    {
        result.push( { key: key, value_now: true } );
        return result;
    }, [] );
};


Encoding.as_object = function( encodings )
{
    return {
        type: Encoding.type.object,           // Since we're listing fields explicitly, it's a transparent object
        seq: encodings.reduce(
            function( result, item )
            {
                return result.concat( item );
            }
        )
    };
};

Encoding.field = function( key, view )
{
    return [
        { key: key, value_now: true, element_view: view }
    ];
};

/**
 * @param {boolean} value_now
 *      True if an immediate value. False if a deferred value.
 * @param {*} [element_view=null]
 */
Encoding.array = function( value_now, element_view )
{
    return {
        type: Encoding.type.array,
        value_now: value_now,
        element_view: ( arguments.length >= 1 ) ? element_view : null
    };
};

exports.Encoding = Encoding;