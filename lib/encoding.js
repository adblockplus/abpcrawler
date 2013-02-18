let {Logger} = require( "logger" );

function tab( indent )
{
    var s = "";
    for ( let i = indent ; i > 0 ; --i )
        s += "    ";
    return s;
}

//-------------------------------------------------------
// Stack-based Formatter
//-------------------------------------------------------
/**
 * Base class for formatters that provides an internal stack.
 * <p>
 * Stack provides a default 'counter' member for detection first/subsequent sequence members to support delimiters.
 * @constructor
 */
var Stack_Format_class = function()
{
    this._format_stack = [];
};

/**
 * @param {Object} x
 *      Stack object. A 'counter' member is added whose initial value is zero.
 */
Stack_Format_class.prototype.push_format = function( x )
{
    this._format_stack.push( x );
    this._format_stack[ this._format_stack.length - 1 ].counter = 0;
};

/**
 * Pop an item off the top of the format stack.
 */
Stack_Format_class.prototype.pop_format = function()
{
    this._format_stack.pop();
};

/**
 * Retrieve the format on the top of the format stack.
 * @param {number} [n]
 * @return {*}
 */
Stack_Format_class.prototype.top_format = function( n )
{
    if ( arguments.length == 0 )
    {
        n = 0;
    }
    return this._format_stack[ this._format_stack.length - n - 1];
};

Stack_Format_class.prototype.counter = function()
{
    return this.top_format( 0 ).counter;
};

Stack_Format_class.prototype.advance = function()
{
    ++this.top_format( 0 ).counter;
};

//-------------------------------------------------------
// JSON Formatter
//-------------------------------------------------------
var JSON_Format = function( sink )
{
    this.sink = sink;
};
JSON_Format.prototype = new Stack_Format_class();

JSON_Format.prototype.primitive = function( value )
{
    this.sink( JSON.stringify( value ) );
};

JSON_Format.prototype.special_null = function()
{
    this.sink( "null" );
};

JSON_Format.prototype.object_begin = function()
{
    this.sink( "{" );
    this.push_format( {} );
};

JSON_Format.prototype.object_before_element = function( key )
{
    if ( this.counter() != 0 )
        this.sink( "," );
    this.advance();
    this.sink( key + ":" );
};

JSON_Format.prototype.object_end = function()
{
    this.sink( "}" );
    this.pop_format();
};

JSON_Format.prototype.array_begin = function()
{
    this.sink( "[" );
    this.push_format( {} );
};

JSON_Format.prototype.array_before_element = function()
{
    if ( this.counter() != 0 )
        this.sink( "," );
    this.advance();
};

JSON_Format.prototype.array_end = function()
{
    this.sink( "]" );
    this.pop_format();
};

//-------------------------------------------------------
// YAML Formatter
//-------------------------------------------------------

var YAML_Format = function( sink )
{
    this.sink = sink;

    this._format_stack = [];

    this.push_format( 0, "", "" );

    this.logger = new Logger( "YAML_format" );
    //this.logger.suppress( true );

    this.trace_token = false;
};

YAML_Format.array_mark = "- ";
YAML_Format.array_extra = "  ";


YAML_Format.prototype.print_stack = function()
{
    var s = "";
    for ( let i = this._format_stack.length ; i-- > 0 ; )
    {
        let f = this._format_stack[i];
        s += "\t-\tindent: " + JSON.stringify( f.indent ) + "\n";
        s += "\t\tprimitive_extra: " + JSON.stringify( f.primitive_extra ) + "\n";
        s += "\t\taggregate_first: " + JSON.stringify( f.aggregate_first ) + "\n";
    }
    return s;
};


YAML_Format.prototype.primitive = function( value )
{
    this._atom( value.toString() );
};

YAML_Format.prototype.special_null = function()
{
    this._atom( "null" );
};

YAML_Format.prototype._atom = function( s )
{
    this.logger.make_log()(
        "PRINT ATOM.\n"
            + "\tvalue = " + JSON.stringify( s ) + "\n"
            + this.print_stack(),
        false
    );
    this.sink( this.top_format().primitive_extra + s + "\n" );
};

//----------------------------------
// YAML_format, object
//----------------------------------

YAML_Format.prototype.object_begin = function()
{
    var format = this.top_format();
    this.push_format( format.indent + 1, " ", "\n" + tab( format.indent + 1 ) );
};

YAML_Format.prototype.object_before_element = function( key )
{
    let parent = this.top_format( 1 );

    if ( this.counter() == 0 )
    {
        this.sink( parent.aggregate_first );
    }
    else
    {
        this.sink( tab( parent.indent ) );
    }
    this.sink( key + ":" );
    this.advance();
};

YAML_Format.prototype.object_end = function()
{
    this.pop_format();
};

//----------------------------------
// YAML_format, array
//----------------------------------

YAML_Format.prototype.array_begin = function()
{
    let parent = this.top_format();
    let prefix = parent.aggregate_first + YAML_Format.array_mark;
    this.push_format( parent.indent + 1, prefix, prefix + YAML_Format.array_extra );
    this.logger.make_log( "array_begin" )(
        "\n\tprefix = " + JSON.stringify( prefix )
            + "\n\tparent = " + JSON.stringify( parent )
            + "\n\tformat = " + JSON.stringify( this.top_format() ),
        false
    )
};

YAML_Format.prototype.array_before_element = function()
{
    let format = this.top_format( 0 );
    let parent = this.top_format( 1 );

    this.logger.make_log( "array_before_element" )(
        "\n\tparent = " + JSON.stringify( parent )
            + "\n\tformat = " + JSON.stringify( format )
            + "\n\tcounter = " + this.counter(),
        false
        //+ "\n\tstack = " + (new Error()).stack
    );

    if ( this.counter() > 0 )
    {
        let prefix = tab( parent.indent ) + YAML_Format.array_mark;
        this.swap_format( format.indent, prefix, prefix + YAML_Format.array_extra );
    }
    this.advance();
};

YAML_Format.prototype.array_end = function()
{
    let format = this.top_format( 0 );
    let parent = this.top_format( 1 );

    this.logger.make_log( "array_end" )(
        "\n\tparent = " + JSON.stringify( parent )
            + "\n\tformat = " + JSON.stringify( format )
            + "\n\tcounter = " + this.counter(),
        false
    );

    if ( this.counter() == 0 )
        this.sink( parent.primitive_extra + "\n" );

    this.pop_format();
};

//----------------------------------
// YAML_format, format stack
//----------------------------------
/**
 * @param {number} indent
 * @param {string} primitive_extra
 * @param {string} aggregate_first
 */
YAML_Format.prototype.push_format = function( indent, primitive_extra, aggregate_first )
{
    this._format_stack.push( {
        indent: indent,
        primitive_extra: primitive_extra,
        aggregate_first: aggregate_first,
        counter: 0
    } );
};

/**
 * @param {number} indent
 * @param {string} primitive_extra
 * @param {string} aggregate_first
 */
YAML_Format.prototype.swap_format = function( indent, primitive_extra, aggregate_first )
{
    var format = this.top_format( 0 );
    format.indent = indent;
    format.primitive_extra = primitive_extra;
    format.aggregate_first = aggregate_first;
};

/**
 * Pop an item off the top of the format stack.
 */
YAML_Format.prototype.pop_format = function()
{
    this._format_stack.pop();
};

/**
 * Retrieve the format on the top of the format stack.
 * @param {number} [n]
 * @return {*}
 */
YAML_Format.prototype.top_format = function( n )
{
    if ( arguments.length == 0 )
    {
        n = 0;
    }
    return this._format_stack[ this._format_stack.length - n - 1];
};

YAML_Format.prototype.counter = function()
{
    return this.top_format( 0 ).counter;
};

YAML_Format.prototype.advance = function()
{
    ++this.top_format( 0 ).counter;
};

//-------------------------------------------------------
// Format_stream
//-------------------------------------------------------
/**
 * Stream output in YAML format.
 * @param {Function} sink
 *      Called with each string segment of the output in sequence.
 * @param format
 *      Either Encoding.YAML or Encoding.JSON
 * @constructor
 */
var Format_stream = function( sink, format )
{
    this.logger = new Logger( "Format_stream" );

    /**
     * Traversal stack. Tracks the depth-first traversal tokens.
     * @type {Array}
     */
    this.stack = [];

    this._writing = false;

    /**
     * Input queue. We only need one token of lookahead, but that means that we need to manage an input token that
     * may be present or not.
     * @type {Array}
     */
    this._input_queue = [];

    this.formatter = new format( sink );

    this.logger.suppress( true );
    this.trace_input = false;
    this.trace_token = false;
};

Format_stream.prototype.sequence_start = function()
{
    this.logger.make_log( "sequence_start" )( "" );
    this._send( { view: { type: Encoding.type.start }, content: { mark: Encoding.type.start } } );
};

Format_stream.prototype.sequence_stop = function()
{
    this.logger.make_log( "sequence_stop" )( "" );
    this._send( { view: { type: Encoding.type.stop }, content: { mark: Encoding.type.stop } } );
};

Format_stream.prototype.sequence_send = function( value )
{
    this._send( { content: { value: value } } );
};

function is_mark( token )
{
    return ("content" in token) && ("mark" in token.content);
}

function is_value( token )
{
    return ("content" in token) && ("value" in token.content);
}

function get_value( token )
{
    return token.content.value;
}

/**
 * Send a token to the state machine.
 * @param token
 * @private
 */
Format_stream.prototype._send = function( token )
{
    if ( !this._writing )
    {
        throw new Error( "May not send tokens when we aren't writing." )
    }
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

Format_stream.prototype.write = function( value, view )
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
 * Predicate: "Is write() available to be called?"
 * @return {boolean}
 */
Format_stream.prototype.may_write = function()
{
    return !this._writing;
};

/**
 * Stack processing machine for a depth-first traversal of an object tree structure where some of the nodes may
 * be deferred streams.
 * @private
 */
Format_stream.prototype._machine = function()
{
    /*
     * The head token of our input stream, if initialized; otherwise undefined
     */
    var token = null;
    /*
     * Predicate: "the variable 'token' and related variables represent the head token of our input stream"
     */
    var have_token = false;
    /*
     *  Predicate: "we need to have a current token"
     */
    var need_token = false;
    /*
     * Predicate: "we need to have a lookahead token in the input queue that hasn't been consumed yet"
     */
    var need_lookahead = false;

    while ( this._has_token() || this._has_input() )
    {
        // Log function indicates stack depth.
        var log = this.logger.make_log( "machine(" + this.stack.length + ")" );

        /*---------------------
         * STAGE ONE: Manage input queue.
         *
         * We need a token if one of the handlers below has asked for it. If we need a token and we don't already have
         * one, we ensure we have one with a yield statement. Since _send() is the only thing that calls us as a
         * generator, we will have an input token after a yield.
         *
         * This section is here as a result of unrolling a recursive-descent algorithm. In that pattern, there would be
         * calls such as queue.get() and queue.lookahead(1). Since we have unrolled everything, such calls occur here at
         * the top of the loop. Code below makes the analogue of queue calls by setting the variables 'need_token' and
         * 'need_lookahead'.
         */
        // Defense
        if ( need_lookahead && need_token )
        {
            /*
             * The head token of the stream cannot exist in two places at once. Either it's on the input queue
             * or it has been consumed and is in the local 'token' variable.
             */
            throw new Error( "Requesting both lookahead and a current token is inconsistent." );
        }

        if ( need_lookahead )
        {
            if ( !have_token )
            {
                if ( !this._has_input() )
                {
                    yield null;
                    // Defense
                    if ( !this._has_input() )
                        throw new Error( "Yielded for lookahead token but did not receive it." );
                }

                log( "Input LOOKAHEAD" +
                    "\n\ttoken = " + JSON.stringify( token ), this.trace_input );
            }
            else
            {
                // Untested
                this._unconsume_input( token );
                have_token = false;
            }
            need_lookahead = false;
        }
        else if ( need_token )
        {
            /*
             * If we already have a token, we don't need to do anything more but clear the need_token flag.
             */
            if ( !have_token )
            {
                if ( !this._has_input() )
                {
                    yield null;
                    // Defense
                    if ( !this._has_input() )
                        throw new Error( "Yielded for current token but did not receive it." );
                }
                // Assert this._has_input()
                token = this._consume_input();
                have_token = true;
            }
            need_token = false;

            log( "Input CURRENT" +
                "\n\ttoken = " + JSON.stringify( token ), this.trace_input );
        }
        else
        {
            // Defense
            if ( !have_token && !this._has_token() && !this._has_input() )
                throw new Error( "No current token, no token on traversal stack, and no token in queue" );
            // Defense
            token = undefined;
        }

        /*---------------------
         * STAGE TWO: Automatic actions, those invoked without input.
         *
         * If we don't have a token, there's one either on the input queue or on the top of the traversal stack. If the
         * traversal stack is empty, we use the input queue. If not, we act according to the state of the token at the
         * top of the traversal stack.
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

            log( "TRAVERSAL STACK TOKEN"
                + "\n\ttop of stack = " + JSON.stringify( c_token )
                + "\n\t" + ((this._has_input()) ? "lookahead = " + JSON.stringify( la_token ) : "no lookahead"),
                this.trace_token
            );

            switch ( c_token.view.type.id )
            {
                case Encoding.type.object.id:
                    if ( c_token.state.i == 0 )
                    {
                        this.formatter.object_begin();
                    }
                    if ( c_token.state.i < c_token.view.seq.length )
                    {
                        let field = c_token.view.seq[ c_token.state.i ];
                        this.formatter.object_before_element( field.key );
                        let new_token = {
                            content: { value: c_token.content.value[ field.key ] }
                        };
                        if ( 'element_view' in field )
                        {
                            new_token.view = field.element_view;
                        }
                        this._insert_input( new_token );
                        need_token = true;
                        ++c_token.state.i;
                    }
                    else
                    {
                        this.formatter.object_end();
                        this._pop_token();
                    }
                    break;

                case Encoding.type.array.id:
                    if ( c_token.state.i == 0 )
                    {
                        this.formatter.array_begin();
                    }
                    if ( c_token.state.i < c_token.content.value.length )
                    {
                        this.formatter.array_before_element();
                        this._insert_input( {
                            view: c_token.view.element_view,
                            content: { value: c_token.content.value[ c_token.state.i ] }
                        } );
                        need_token = true;
                        ++c_token.state.i;
                    }
                    else
                    {
                        this.formatter.array_end();
                        this._pop_token();
                    }
                    break;

                case Encoding.type.array_stream.id:
                    if ( !this._has_input() )
                    {
                        // If we can't see the next token, we can't proceed.
                        need_lookahead = true;
                        break;
                    }
                    if ( is_mark( la_token ) )
                    {
                        switch ( la_token.view.type.id )
                        {
                            case Encoding.type.start.id:
                                let first_pass = ( c_token.state.i == 0 );
                                if ( first_pass )
                                {
                                    /*
                                     * Always consume a start token the first time we see one. So this one's ours.
                                     */
                                    this._consume_input();
                                    have_token = false;
                                    this.formatter.array_begin();
                                }

                                /*
                                 * Here we have the analogue of a shift-reduce decision. If the 'element_view' field
                                 * in the array specification is an ordinary type, we reduce to the rule that the next
                                 * elements are part of our list. If that field is a stream type, we need to shift to a
                                 * new list. In the second case, it means we need a new node on the top of the stack.
                                 */
                                let x = c_token.view.element_view;
                                if ( x && x.type.stream )
                                {
                                    /*
                                     * We need to associate the present start mark with a stream token we create. In
                                     * order to do that, we need the stream token to appear before the start mark. Thus
                                     * we stuff a token onto the _back_ end of the queue so that it's the next token
                                     * consumed. The start mark will then be consumed at the iteration following.
                                     */
                                    this._unconsume_input( { view: x, content: { value: null } } );
                                }
                                else
                                {
                                    /*
                                     * We have a start mark at some point after the first pass. That's only valid
                                     * when our element type is a stream type, which it's not at this point.
                                     */
                                    if ( !first_pass )
                                    {
                                        /*
                                         * This is not an internal defense, but an external one. If the user
                                         * makes a call to sequence_start() at the wrong time, we'll end up here.
                                         */
                                        throw new Error( "unexpected call to sequence_start()" );
                                    }
                                    /*
                                     * Note that if 'element_view' is defined but not a stream, that we have a type
                                     * specified for unseen elements. There might be a type conflict here. We are
                                     * resolving that conflict by ignoring 'element_view' unless it's a stream type.
                                     */
                                }
                                /*
                                 * Because the next token could be a stop mark, we don't load it as a current token.
                                 * Marks are always consumed as lookahead.
                                 */
                                need_lookahead = true;

                                log( "processed start mark"
                                    + "\n\ttop of stack = " + JSON.stringify( this._top_token() ),
                                    false );
                                break;
                            case Encoding.type.stop.id:
                                this._consume_input();
                                have_token = false;
                                this._pop_token();
                                this.formatter.array_end();
                                break;
                            default:
                                throw new Error( "Unexpected mark seen for array_stream" );
                        }
                    }
                    else
                    {
                        // Assert the lookahead token is a regular token, since it's not a mark
                        this.formatter.array_before_element();
                        ++c_token.state.i;
                        // Don't use more than 10 million elements in an array.
                        if ( c_token.state.i > 10000000 )
                            throw new Error( "Runaway loop" );
                        need_token = true;
                    }
                    break;
                default:
                    throw new Error( "Found token type that should not appear as a non-input token" );
            }
            /*
             * We're skipping all the code below and going back to the top of the loop, where any 'need_token' or
             * 'need_lookahead' requests can be fulfilled.
             */
            continue;
        }

        /*---------------------
         * Initialize the local variable 'value'. We may have received a mark, which requires different initialization.
         */
        // Defense
        if ( is_mark( token ) )
            throw new Error( "Value token expected; mark token found." );
        // Defense
        if ( !is_value( token ) )
            throw new Error( "Value token expected; neither value nor mark token found." );
        var value = get_value( token );

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
            try
            {
                if ( "__encoding__" in value )
                {
                    token.view = value["__encoding__"];
                }
                else
                {
                    token.view = {};
                }
            }
            catch ( e )
            {
                token.view = {};
            }
        }
        var view = token.view;

        /*---------------------
         * Honor a toJSON replacement object, if any. Note that we do this _after_ getting an encoding from the value,
         * should we need to.
         */
        try
        {
            if ( "toJSON" in value )
            {
                value = value.toJSON();
            }
        }
        catch ( e )
        {
            // Disregard errors. The most likely one happens when 'value' is not an object at all.
        }

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
            + "\n\t" + ( ('state' in token) ? "state = " + JSON.stringify( token.state ) : "no state" ),
            this.trace_token
        );

        /*---------------------
         * Process a single iteration step of the state machine.
         *
         * - If there's a deferred value, push the next state on to the stack.
         * - If there's an immediate value, write it to the sink.
         */
        /*
         * If we get this far, we'll consume the token in each case.
         */
        have_token = false;
        if ( view.type.aggregate )
        {
            this._push_token( token );
            // We'll loop back to the top and process the top of the stack next.
            // Assert need_lookahead == false && need_token == false && have_token == false
        }
        else
        {
            switch ( view.type.id )
            {
                case Encoding.type.null.id:
                    this.formatter.special_null();
                    break;
                case Encoding.type.primitive.id:
                    this.formatter.primitive( value );
                    break;
                default:
                    throw new Error( "unexpected encoding type" );
                    break;
                /*
                 * If we need to output "undefined", we'd do it here.
                 */
            }
        }
    }
    log = this.logger.make_log( "machine(" + this.stack.length + ")" );
    log( "machine end" );
    this._writing = false;
};

//----------------------------------
// YAML_stream, traversal stack
//----------------------------------
/**
 * Push a token onto the top of the traversal stack. Only aggregates go onto this stack. From the point of view of
 * a graph traversal, atomic elements are leaf nodes and do not appear on the stack, and aggregates are non-leaf nodes
 * and do appear. Since an aggregate may only be pushed once onto the traversal stack, we do initialization and a
 * validation check here.
 * @param token
 * @private
 */
Format_stream.prototype._push_token = function( token )
{
    if ( "state" in token )
    {
        throw new Error( "An aggregate type may not be pushed more than once onto the traversal stack" );
    }
    else
    {
        token.state = { i: 0 };
    }

    if ( this.stack.length > 100 )
        throw new Error( "stack overflow" );

    this.stack.push( token );
};

/**
 * The token on top of the traversal stack.
 * @return {*}
 * @private
 */
Format_stream.prototype._top_token = function()
{
    return this.stack[ this.stack.length - 1 ];
};

/**
 * Pop a token off the top of the traversal stack.
 * @return {*}
 * @private
 */
Format_stream.prototype._pop_token = function()
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
Format_stream.prototype._has_token = function()
{
    return this.stack.length != 0;
};

//----------------------------------
// YAML_stream, input queue
//----------------------------------
/**
 * Predicate "does the input queue have a token ready for us?"
 * @private
 */
Format_stream.prototype._has_input = function()
{
    return this._input_queue.length > 0;
};

/**
 * Look-ahead function. We shouldn't need more than to call this with n=0.
 * @param {number} [n=0]
 * @private
 */
Format_stream.prototype._look_input = function( n )
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
Format_stream.prototype._insert_input = function( input )
{
    return this._input_queue.push( input );
};

/**
 * Retrieve a token from the input queue and remove it so that it won't be examined again.
 * @return {*}
 * @private
 */
Format_stream.prototype._consume_input = function()
{
    return this._input_queue.shift();
};

/**
 * Stuff a token back into the back end of the queue so that it will be seen again.
 * @param token
 * @return {*}
 * @private
 */
Format_stream.prototype._unconsume_input = function( token )
{
    this._input_queue.unshift( token );
};

//-------------------------------------------------------
// Encoding
//-------------------------------------------------------

/**
 * The export object for this module.
 */
var Encoding = { YAML: YAML_Format, Format_stream: Format_stream, JSON: JSON_Format };
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
    object: { id: 2, name: "object", aggregate: true },
    /**
     * An array object
     */
    array: { id: 3, name: "array", aggregate: true },
    /**
     * An array object
     */
    array_stream: { id: 4, name: "array_stream", aggregate: true, stream: true },
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
        result.push( { key: key } );
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
        { key: key, element_view: view }
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