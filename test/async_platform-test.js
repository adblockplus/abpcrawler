/**
 * @fileOverview A platform-specific primitive set for the module async.js.
 */

/**
 * @namespace
 */
Async_Platform = {};

Async_Platform.dispatch = function( f )
{
  return setTimeout( f, 0 );
};
