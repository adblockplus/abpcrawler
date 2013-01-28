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
     * Traversal stack. Tracks the depth-first traversal tokens.
     * @type {Array}
     */
    this.stack = [];

    /**
     * Output stack. Tracking formatting items such as indent level, infix strings, etc.
     * @type {Array}
     */
    this.format_stack = [];

    this._writing = false;

    /**
     * Input queue. We only need one token of lookahead, but that means that we need to manage an input token that
     * may be present or not.
     * @type {Array}
     */
    this._input_queue = [];
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
    this.generator.send( { value: value } );
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
    /*
     * Consistency check to ensure that the caller has been feeding us correctly. If this throws, it means the
     * caller has made a mistake.
     */
    if ( this._writing )
        throw new Error( "Already writing" );
    this._writing = true;

    /*
     * Initialize the input queue with a single token, the one that will be expanded.
     *
     * Start the generator and bring it
     * to its first yield statement. It will stop if there are no stream inputs within the token, so we check for that.
     */
    this._push_token( view, {value: value} );
    this._push_format( 0, "", "" );
    var g = this._machine();
    this.generator = g;
    try
    {
        g.next();
    }
    catch ( e )
    {
        if ( e !== StopIteration ) throw e;
    }
};

/**
 * Stack processing machine for a depth-first traversal of an object tree structure where some of the nodes may
 * be deferred streams.
 * @private
 */
YAML_stream.prototype._machine = function()
{
    while ( this._has_token() || this._has_input() )
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
        var token = this._top_token();

        if ( "view" in token )
        {
            var view = token.view;
        }
        if ( !view )
        {
            view = {};
        }

        /*---------------------
         * STAGE TWO: We need a token if we have an immediate view. Obtain one if necessary.
         *
         * - If there's a token in the context, we use that one.
         * - If not, we yield for one.
         */
        if ( "content" in token )
        {
            var received_content = token.content;
            var qq = "token"
        }
        else
        {
            received_content = yield null;
            qq = "yield"
        }
        log( "Received " + qq + " content =" + JSON.stringify( received_content ) );
        /*
         * A token has either a value or a mark. If it's a mark, then we treat it as if we had been supplied
         * an immediate view without a value. Processing of such tokens must not require a value.
         */
        if ( "value" in received_content )
        {
            var value = received_content.value;
        }
        else
        {
            /*
             * Receiving a mark acts like a special processing directive rather than a value.
             */
            value = undefined;
            log( "Received mark.\n\tmark = " + JSON.stringify( received_content.mark )
                + "\n\told view = " + JSON.stringify( view ) );
            view = { type: received_content.mark, content: null };
            /*
             * We're overwriting the existing view here, which is suspicious to me.
             */
        }

        /*---------------------
         * STAGE THREE: If we still need a type within our view, we need to infer one from the value we have.
         */
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

        log( "STAGE FOUR.\n\tvalue = " + JSON.stringify( value )
            + "\n\tview = " + JSON.stringify( view )
            + "\n\tstate " + ( ('state' in token) ? "= " + JSON.stringify( token.state ) : "missing" )
        );

        /*---------------------
         * STAGE FOUR: Process a single iteration step of the state machine.
         *
         * - If there's a deferred value, push the next state on to the stack.
         * - If there's an immediate value, write it to the sink.
         */
        var format_context = this.top_format();
        switch ( view.type.id )
        {
            case Encoding.type.null.id:
                this.sink( format_context.primitive_extra + "null\n" );
                this._pop_token();
                break;
            case Encoding.type.primitive.id:
                this.sink( format_context.primitive_extra + value.toString() + "\n" );
                this._pop_token();
                break;
            case Encoding.type.object.id:
                throw new Error( "Objects not implemented" );

                let recurring_extra = "\n" + tab( format_context.indent + 1 );
                for ( let i = 0 ; i < view.seq.length ; ++i )
                {
                    let field = view.seq[ i ];
                    let k = field.key;
                    this.sink( ( i == 0 ) ? format_context.aggregate_extra : tab( format_context.indent ) );
                    this.sink( k + ":" );
                    /*
                     * Create a recursive generator and start it with a dummy call to next(). Because of the initial yield
                     * statement at the beginning, the first call to next() can never throw StopIteration.
                     */
                    this._push_format( format_context.indent + 1, " ", recurring_extra );
                    this._push_token( null );
                }
                break;
            case Encoding.type.array.id:
                if ( !( "state" in token ) )
                {
                    token.state = { i: 0 };
                    this._push_format( format_context.indent, "", YAML.array_extra );
                }
                if ( token.state.i < value.length )
                {
                    this.sink( ( token.state.i == 0 ) ? format_context.aggregate_extra : tab( format_context.indent ) );
                    this.sink( YAML.array_mark );
                    this._push_token(
                        view.element_view,
                        { value: value[ token.state.i ] }
                    );
                    ++token.state.i;
                }
                else
                {
                    this.pop_format();
                    this._pop_token();
                    /*
                     * A zero-length array still needs a newline, since all values need one at the end of their output.
                     */
                    if ( token.state.i == 0 )
                        this.sink( "\n" );
                }
                break;
            case Encoding.type.array_stream.id:
            {
                let is_initial_pass = !( "state" in token );
                if ( is_initial_pass )
                {
                    token.state = { i: 0 };
                    log( "array_stream, 1.\n\ttop of stack = " + JSON.stringify( this._top_token() ) );
                    let prefix = format_context.aggregate_extra + YAML.array_mark;
                    this._push_format( format_context.indent, prefix, prefix + YAML.array_extra );
                    /*
                     * Yield to accept our start mark.
                     */
                    let t = yield null;
                    if ( ( 'mark' in t ) && t.mark === Encoding.type.stop )
                    {
                        /*
                         * In the case of nested streams, we can receive a stop marker that belongs to a parent. We
                         * simply leave it on top of the input stack and let it propagate upward.
                         */
                        let x = this._pop_token();
                        this._push_token( t.mark );
                        break;
                    }
                    if ( !( 'mark' in t && t.mark === Encoding.type.start ) )
                    {
                        throw new Error( "Received something other than sequence_start. stack height = " + this.stack.length );
                    }
                }
                else
                {
                    if ( !( 'i' in token.state ) )
                        throw new Error( "Missing call to sequence_start()" );
                    ++token.state.i;
                    if ( token.state.i > 7 )
                        throw new Error( "Runaway loop" );

                    if ( token.state.i == 1 )
                    {
                        this.pop_format();
                        let prefix = tab( format_context.indent ) + YAML.array_mark;
                        this._push_format( format_context.indent, prefix, prefix + YAML.array_extra );
                    }
                }
                if ( view.element_view && view.element_view.type.stream )
                {
                    this._push_token( view.element_view, { value: "array level " + this.stack.length } );
                }
                else
                {
                    this._push_token( view.element_view );
                }
                break;
            }
            case Encoding.type.start.id:
                break;
            case Encoding.type.stop.id:
                /*
                 * First call to pop() removes the end marker. The top of the stack is then the array frame. We deal
                 * with zero length arrays, then remove the array frame.
                 */
                this._pop_token();
                if ( this._top_token().state.i == 0 )
                    this.sink( "\n" );
                this._pop_token();
                this.pop_format();
                log( "Processed stop marker. stack height = " + this.stack.length );
                break;
            case Encoding.type.deferred.id:
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
 * Push a token onto the top of the traversal stack.
 * @param view
 * @param token
 * @private
 */
YAML_stream.prototype._push_token = function( view, token )
{
    var x = {};
    x.view = view;
    if ( arguments.length >= 2 )
    {
        x.content = token;
    }

    if ( this.stack.length > 100 )
        throw new Error( "stack overflow" );

    this.stack.push( x );
};

/**
 * The token on top of the traversal stack.
 * @return {*}
 * @private
 */
YAML_stream.prototype._top_token = function()
{
    return this.stack[ this.stack.length - 1 ];
};

/**
 * Pop a token off the top of the traversal stack.
 * @return {*}
 * @private
 */
YAML_stream.prototype._pop_token = function()
{
    if ( this.stack.length == 0 )
        throw new Error( "Stack empty" );
    return this.stack.pop();
};

/**
 * Predicate "Is the traversal stack non-empty?"
 * @return {boolean}
 * @private
 */
YAML_stream.prototype._has_token = function()
{
    return this.stack.length != 0;
};

/**
 * @param {number} indent
 * @param {string} primitive_extra
 * @param {string} aggregate_extra
 * @private
 */
YAML_stream.prototype._push_format = function( indent, primitive_extra, aggregate_extra )
{
    this.format_stack.push( {
        indent: indent,
        primitive_extra: primitive_extra,
        aggregate_extra: aggregate_extra
    } );
};

YAML_stream.prototype.pop_format = function()
{
    this.format_stack.pop();
};

YAML_stream.prototype.top_format = function()
{
    return this.format_stack[ this.format_stack.length - 1];
};

/**
 * Predicate "does the input queue have a token ready for us?"
 * @private
 */
YAML_stream.prototype._has_input = function()
{
    return this._input_queue.length > 0;
};

/**
 * Look-ahead function. We shouldn't need more than to call this with n=0.
 * @param {number} [n=0]
 * @private
 */
YAML_stream.prototype._look_input = function( n )
{
    if ( arguments.length == 0 )
        n = 0;
    return this._input_queue[ n ];
};

/**
 * Put a token into the input queue.
 * @param input
 * @private
 */
YAML_stream.prototype._insert_input = function( input )
{
    return this._input_queue.push( input );
};

/**
 * Retrieve a token from the input queue and remove it so that it won't be examined again.
 * @return {*}
 * @private
 */
YAML_stream.prototype._consume_input = function()
{
    return this._input_queue.shift();
};

/**
 * Stuff a token back into the back end of the queue so that it will be seen again. The ordinary behavior is that
 * tokens are consumed when first seen. There are cases when this is not right, so it's cleaner to reverse explicitly
 * in that case rather than explicit consume everywhere else.
 * @return {*}
 * @private
 */
YAML_stream.prototype._unconsume_input = function( token )
{
    this._input_queue.unshift( token );
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
    array_stream: { id: 4, name: "array_stream", stream: true },
    /**
     * A start marker for the beginning of a deferred sequence
     */
    start: { id: 5, name: "start" },
    /**
     * A stop marker for the end of a deferred sequence
     */
    stop: { id: 6, name: "stop" },
    /**
     * A pseudovalue that replaces itself with an actual one from the input source
     */
    deferred: {id: 7, name: "deferred"}
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