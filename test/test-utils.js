/**
 * Test utilities for node:test migration
 */

/**
 * Create a mock function that tracks calls and returns specified values.
 * @param {any} [returnValue] - Value to return (or function to call)
 * @returns {Function & { calls: any[][], mockReturnValue: Function, mockResolvedValue: Function, mockResolvedValueOnce: Function }}
 */
function createMock(returnValue) {
  const calls = [];
  const returnQueue = [];

  const fn = function (...args) {
    calls.push(args);
    if (returnQueue.length > 0) {
      return returnQueue.shift();
    }
    if (typeof returnValue === 'function') {
      return returnValue(...args);
    }
    return returnValue;
  };

  fn.calls = calls;
  fn.mockReturnValue = (val) => {
    returnValue = val;
    return fn;
  };
  fn.mockResolvedValue = (val) => {
    returnValue = Promise.resolve(val);
    return fn;
  };
  fn.mockResolvedValueOnce = (val) => {
    returnQueue.push(Promise.resolve(val));
    return fn;
  };

  return fn;
}

module.exports = { createMock };
