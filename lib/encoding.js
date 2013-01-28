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

    this._writing = false;
};

YAML_stream.prototype.sequence_start = function()
{
    this.logger.make_log( "sequence_start" )( "" );
    this._send( { mark: Encoding.type.start } );
};

YAML_stream.prototype.sequence_stop = function()
{
    this.logger.make_log( "sequence_stop" )( "" );
    this._send( { mark: Encoding.type.stop } );
};

YAML_stream.prototype.sequence_send = function( value )
{
    this.generator._send( { value: value } );
};

YAML_stream.prototype._send = function( token )
{
    try
    {
        this.generator.send( token );
    }
    catch ( e )
    {
        if ( e === StopIteration )
        // This is expected if it stops the last deferred sequence in the object.
            return;
        throw e;
    }
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
    this.push( view, 0, "", "", {value: value} );
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
    while ( this.stack_is_nonempty() )
    {
        // Log function indicate stack depth.
        var log = this.logger.make_log( "machine(" + this.stack.length + ")" );

        /*---------------------
         * STAGE ONE: Obtain a view object.
         *
         * A view can arise in three different ways:
         *      1) From a view specification. This is the only way that deferred items can arise.
         *      2) By inference from a value. This is the ordinary way for most values.
         *      3) By explicit specification on the object. [Not yet supported.] Moral equivalent of toJSON().
         */
        /*
         * The (current) representation of a view is as a member of the context.
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

        //        if ( "type" in view && view.type.id == Encoding.type.array.id && !value )
        //        {
        //            throw new Error( "consistency problem." )
        //        }

        /*---------------------
         * STAGE TWO: We need a token if we have an immediate view. Obtain one if necessary.
         *
         * - If there's a token in the context, we use that one.
         * - If not, we yield for one.
         */
        if ( "token" in context )
        {
            var token = context.token;
        }
        else
        {
            token = yield null;
        }
        /*
         * A token has either a value or a mark. If it's a mark, then we treat it as if we had been supplied
         * an immediate view without a value. Processing of such tokens must not require a value.
         */
        if ( "value" in token )
        {
            var value = token.value;
        }
        else
        {
            /*
             * Receiving a mark acts like a special processing directive rather than a value.
             */
            value = undefined;
            log( "Received mark = " + JSON.stringify( token.mark )
                + "\nold view = " + JSON.stringify( view ) );
            view = { type: token.mark };
            /*
             * We're overwriting the existing view here, which is suspicious to me.
             */
        }

        /*---------------------
         * STAGE THREE: If we still need a type within our view, we need to infer one from the value we have.
         */
        log( "view = " + JSON.stringify( view ) );
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

        /*---------------------
         * STAGE FOUR: Process a single iteration step of the state machine.
         *
         * - If there's a deferred value, push the next state on to the stack.
         * - If there's an immediate value, write it to the sink.
         */
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
                if ( !( "state" in context ) )
                {
                    context.state = { i: 0 };
                }
                if ( context.state.i < value.length )
                {
                    this.sink( YAML.array_mark );
                    this.sink( ( context.state.i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                    this.push(
                        view.element_view,
                        context.indent + 1, "", YAML.array_extra,
                        { value: value[ context.state.i ] }
                    );
                    ++context.state.i;
                }
                else
                {
                    this.pop();
                    /*
                     * A zero-length array still needs a newline, since all values need one at the end of their output.
                     */
                    if ( context.state.i == 0 )
                        this.sink( "\n" );
                }
                break;
            case Encoding.type.array_stream.id:
            {
                /*
                 * There's no 'value' argument in building the frame so that we obtain a deferred value in the
                 * next iteration.
                 *
                 * We compute a prefix so that we can defer its output until after we know we have a value for it
                 * to precede.
                 */
                let prefix = YAML.array_mark
                    + ( ( context.state.i == 0 ) ? context.aggregate_extra : tab( context.indent )
                    );
                this.push(
                    view.element_view,
                    context.indent + 1, prefix, prefix + YAML.array_extra
                );
                ++context.state.i;
                /*
                 * If this was the first time we saw the array type, we need to push another frame onto the stack
                 * to ensure that the user calls sequence_start().
                 */
                if ( is_initial_pass )
                {
                    this.push( {type: Encoding.type.start}, 0, "", "" );
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
                log(
                    "Processing end marker" );
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
 * @param {*} [token]
 */
YAML_stream.prototype.push = function( view, indent, primitive_extra, aggregate_extra, token )
{
    if ( this.stack.length > 100 )
        throw new Error( "stack overflow" );

    this.stack.push( new YAML_state( view, indent, primitive_extra, aggregate_extra, token ) );
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
// YAML_state
//-------------------------------------------------------
var YAML_state = function( view, indent, primitive_extra, aggregate_extra, token )
{
    this.view = view;
    this.indent = indent;
    this.primitive_extra = primitive_extra;
    this.aggregate_extra = aggregate_extra;
    this.token = token;
};
YAML_state.prototype = {
    view: undefined,
    indent: 0,
    primitive_extra: "",
    aggregate_extra: "",
    token: undefined
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
     * An array object
     */
    array_stream: { id: 4, name: "array_stream" },
    /**
     * A start marker for the beginning of a deferred sequence
     */
    start: { id: 5, name: "start" },
    /**
     * A stop marker for the end of a deferred sequence
     */
    stop: { id: 6, name: "stop" }
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
 * @param {*} [element_view=null]
 */
Encoding.array = function( element_view )
{
    return {
        type: Encoding.type.array,
        element_view: ( arguments.length >= 1 ) ? element_view : null
    };
};

/**
 * @param {*} element_view=null
 */
Encoding.array_stream = function( element_view )
{
    return {
        type: Encoding.type.array_stream,
        element_view: element_view
    };
};

exports.Encoding = Encoding;