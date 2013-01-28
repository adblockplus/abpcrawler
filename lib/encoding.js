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
    this._send( { view: { type: Encoding.type.start }, content: { mark: Encoding.type.start } } );
};

YAML_stream.prototype.sequence_stop = function()
{
    this.logger.make_log( "sequence_stop" )( "" );
    this._send( { view: { type: Encoding.type.stop }, content: { mark: Encoding.type.stop } } );
};

YAML_stream.prototype.sequence_send = function( value )
{
    this._send( { content: { value: value } } );
};

/**
 * Send a token to the state machine.
 * @param token
 * @private
 */
YAML_stream.prototype._send = function( token )
{
    this.logger.make_log( "_send" )( "SEND: " + "\n\ttoken = " + JSON.stringify( token ), false );
    try
    {
        this._insert_input( token );
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
    this._insert_input( { view: view, content: { value: value } } );
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
    var token = null;

    /*
     * The look-ahead token may or may not exist.
     */
    var have_token = false;
    /*
     *  Predicate: "we need to see a lookahead token"
     */
    var need_token = false;

    var need_lookahead = false;

    while ( this._has_token() || this._has_input() )
    {
        // Log function indicates stack depth.
        var log = this.logger.make_log( "machine(" + this.stack.length + ")" );

        /*---------------------
         * We need a token if one of the handlers below has asked for it. If we a token and we don't already
         * have one, we ensure we have one with a yield statement. Since _send() is the only thing that calls
         * the generator, we'll have an input token after the yield.
         */
        if ( ( ( need_token && !have_token ) || need_lookahead ) && !this._has_input() )
        {
            yield null;
            // Assert this._has_input()
            if ( !this._has_input() )
                throw new Error( "Yielded for input but did not receive it.")

            need_lookahead = false;
        }

        if ( need_token && !have_token )
        {
            if ( !this._has_input() )
                throw new Error( "input token not present as expected" );

            token = this._consume_input();
            have_token = true;
            need_token = false;     // we have fulfilled the request implicit in 'need_token'
            log( "TOKEN" +
                "\n\ttoken = " + JSON.stringify( token ), false );
        }
        else
        {
            token = undefined;      // This assignment exposes defects in the state machine code.
        }

        if ( need_token )
            Cu.reportError( "inconsistent need_token value" );

        /*---------------------
         * Sometimes we don't have a token, but we also don't need one. We'll skip all the value-oriented code below and
         * make automatic state changes that happen without input tokens. These changes are based not on the input
         * token, but on the token on top of the stack.
         */
        if ( !have_token )
        {
            if ( !this._has_token() )
            {
                /*
                 * The token stack is empty. There must be something on the input queue for use to still be here.
                 */
                need_token = true;
                continue;
            }

            // Current Token
            let c_token = this._top_token();
            // Look-Ahead Token
            var la_token = this._look_input();

            log( "NO INPUT TOKEN"
                + "\n\ttop of stack = " + JSON.stringify( c_token )
                + "\n\t" + ((this._has_input()) ? "lookahead = " + JSON.stringify( la_token ) : "no input"),
                true
            );

            let format = this._top_format();
            switch ( c_token.view.type.id )
            {
                case Encoding.type.array.id:
                    if ( c_token.state.i < c_token.content.value.length )
                    {
                        this.sink( YAML.array_mark );
                        this._insert_input( {
                            view: view.element_view,
                            content: { value: c_token.content.value[ c_token.state.i ] }
                        } );
                        need_token = true;
                        ++c_token.state.i;
                    }
                    else
                    {
                        this._pop_format();
                        this._pop_token();
                        /*
                         * A zero-length array still needs a newline, since all values need one at the end of their output.
                         */
                        if ( c_token.state.i == 0 )
                            this.sink( "\n" );
                    }
                    break;
                case Encoding.type.array_stream.id:
                    if ( !this._has_input() )
                    {
                        // If we can't see the next token, we can't proceed.
                        need_lookahead = true;
                        break;
                    }
                    if ( 'mark' in la_token.content )
                    {
                        switch ( la_token.view.type.id )
                        {
                            case Encoding.type.start.id:
                                if ( 'state' in c_token )
                                    throw new Error( "unexpected call to sequence_start()" );
                                c_token.state = { i: 0 };
                                this._consume_input();
                                have_token = false;
                                this.need_lookahead = true;

                                log( "processed start mark"
                                    + "\n\ttop of stack = " + JSON.stringify( this._top_token() ),
                                    false );

                                break;
                            case Encoding.type.stop.id:
                                throw new Error( "Stop token handling is not written yet." )
                                break;
                            default:
                                throw new Error( "Unexpected mark seen for array_stream" );
                        }
                    }
                    // Assert we have a regular token
                    ++c_token.state.i;
                    if ( c_token.state.i > 7 )
                        throw new Error( "Runaway loop" );

                    if ( c_token.state.i == 1 )
                    {
                        this._pop_format();
                        let prefix = tab( format_context.indent ) + YAML.array_mark;
                        this._push_format( format_context.indent, prefix, prefix + YAML.array_extra );
                    }
                    need_token = true;
            }
            /*
             * We're skipping all the code below and going back to the top of the loop, where any 'need_token'
             * requests can be fulfilled.
             */
            continue;
        }

        /*---------------------
         * Initialize the local variable 'value'. We may have received a mark, which requires different initialization.
         */
        log( "needed input token:"
            + "\n\ttoken = " + JSON.stringify( token ), false );

        if ( !( 'content' in token ) )
            throw new Error( "Field 'content' not found in input token." );
        var content = token.content;
        if ( "value" in content )
        {
            var value = content.value;
        }
        else
        {
            /*
             * Receiving a mark acts like a special processing directive rather than a value.
             */
            value = undefined;
            view = token.view;

            log( "Received mark."
                + "\n\tmark = " + JSON.stringify( content.mark ),
                false );
        }

        /*---------------------
         * Obtain a view object.
         *
         * A view can arise in three different ways:
         *      1) From a view specification. This is the only way that deferred items can arise.
         *      2) By inference from a value. This is the ordinary way for most values.
         *      3) By explicit specification on the object. [Not yet supported.] Moral equivalent of toJSON().
         */
        if ( !( "view" in token ) || !token.view )
        {
            token.view = {};
        }
        var view = token.view;

        /*---------------------
         * If we still need a type within our view, we need to infer one from the value we have.
         */
        if ( !( "type" in view ) )
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

        log( "INPUT TOKEN.\n\tvalue = " + JSON.stringify( value )
            + "\n\tview = " + JSON.stringify( view )
            + "\n\t" + ( ('state' in token) ? "state = " + JSON.stringify( token.state ) : "no state" )
        );

        /*---------------------
         * Process a single iteration step of the state machine.
         *
         * - If there's a deferred value, push the next state on to the stack.
         * - If there's an immediate value, write it to the sink.
         */
        var format_context = this._top_format();
        /*
         * If we get this far, we'll consume the token in each case.
         */
        have_token = false;
        switch ( view.type.id )
        {
            case Encoding.type.null.id:
                this.sink( format_context.primitive_extra + "null\n" );
                break;
            case Encoding.type.primitive.id:
                this.sink( format_context.primitive_extra + value.toString() + "\n" );
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
                    this._push_format( format_context.indent + 1, " ", recurring_extra );
                    this._push_token_legacy( null );
                }
                break;
            case Encoding.type.array.id:
                if ( !( "state" in token ) )
                {
                    token.state = { i: 0 };
                    this._push_format( format_context.indent, "", YAML.array_extra );
                    this._push_token( token );
                }
                else
                {
                    throw new Error( "Should only see 'array' as input token once" );
                }
                break;
            case Encoding.type.array_stream.id:
            {
                let is_initial_pass = !( "state" in token );
                if ( is_initial_pass )
                {
                    log( "array_stream, 1.\n\ttop of stack = " + JSON.stringify( this._top_token() ) );
                    let prefix = format_context.aggregate_extra + YAML.array_mark;
                    this._push_format( format_context.indent, prefix, prefix + YAML.array_extra );
                    this._push_token( token );
                }
                //                if ( view.element_view && view.element_view.type.stream )
                //                {
                //                    this._push_token_legacy( view.element_view, { value: "array level " + this.stack.length } );
                //                }
                //                else
                //                {
                //                    this._push_token_legacy( view.element_view );
                //                }
                break;
            }
            case Encoding.type.start.id:
            {
                let t = this._top_token();
                if ( 'state' in t )
                    throw new Error( "unexpected call to sequence_start()" );
                t.state = { i: 0 };

                log( "processed start mark"
                    + "\n\ttop of stack = " + JSON.stringify( this._top_token() ),
                    false );

                break;
            }
            case Encoding.type.stop.id:
                /*
                 * First call to pop() removes the end marker. The top of the stack is then the array frame. We deal
                 * with zero length arrays, then remove the array frame.
                 */
                if ( this._top_token().state.i == 0 )
                    this.sink( "\n" );
                this._pop_token();
                this._pop_format();
                log( "Processed stop marker. stack height = " + this.stack.length );
                break;
            case Encoding.type.deferred.id:
                break;
            default:
                throw new Error( "unexpected encoding type" );
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
 * @param content
 * @private
 */
YAML_stream.prototype._push_token_legacy = function( view, content )
{
    var x = {};
    x.view = view;
    if ( arguments.length >= 2 )
    {
        x.content = content;
    }
    this._push_token( x );
};

/**
 * Push a token onto the top of the traversal stack.
 * @param token
 * @private
 */
YAML_stream.prototype._push_token = function( token )
{
    if ( this.stack.length > 100 )
        throw new Error( "stack overflow" );

    this.stack.push( token );
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

/**
 * Pop an item off the top of the format stack.
 * @private
 */
YAML_stream.prototype._pop_format = function()
{
    this.format_stack.pop();
};

/**
 * Retrieve the format on the top of the format stack.
 * @return {*}
 * @private
 */
YAML_stream.prototype._top_format = function()
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
 * @param token
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