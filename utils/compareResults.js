const { sendTelegramAlert } = require('./telegramUtils');

/**
 * Recursively normalizes JSON by sorting object keys
 * This ensures that objects with the same data but different key ordering are considered equal
 * @param {*} obj - The object to normalize
 * @param {Set} seen - Set to track circular references
 * @returns {*} The normalized object
 */
function normalizeJSON(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle circular references
  if (seen.has(obj)) {
    return '[Circular]';
  }
  seen.add(obj);
  
  try {
    if (Array.isArray(obj)) {
      return obj.map(item => normalizeJSON(item, new Set(seen)));
    }
    
    // Sort object keys and recursively normalize values
    const sorted = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = normalizeJSON(obj[key], new Set(seen));
    });
    return sorted;
  } catch (error) {
    console.error('Error normalizing JSON:', error.message);
    return obj; // Return original object if normalization fails
  }
}

/**
 * Safely stringifies a value with error handling
 * @param {*} value - The value to stringify
 * @returns {string} The stringified value or error indicator
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error('Error stringifying value:', error.message);
    return `[Unstringifiable: ${error.message}]`;
  }
}

/**
 * Compares RPC responses from multiple nodes to check for consensus and identify mismatches
 * @param {Map<string, Object>} responseMap - Map of client IDs to their responses
 * @param {Map<string, Object>} poolMap - Map of client IDs to their node information
 * @param {string} method - The RPC method that was called
 * @returns {Object} Result object containing:
 *   - resultsMatch: boolean indicating if all responses match
 *   - mismatchedNode: ID of the node with mismatched response
 *   - mismatchedOwner: Owner of the node with mismatched response
 *   - mismatchedResults: Array of mismatched results with details
 */
function compareResults(responseMap, poolMap, method = 'unknown') {
  // Initialize return object
  const result = {
    resultsMatch: false,
    mismatchedNode: 'nan',
    mismatchedOwner: 'nan',
    mismatchedResults: []
  };

  try {
    return _compareResultsInternal(responseMap, poolMap, method, result);
  } catch (error) {
    console.error('Critical error in compareResults:', error.message, error.stack);
    // Return safe default on critical error
    result.resultsMatch = true; // Assume match if comparison fails
    result.mismatchedResults = [`Comparison error: ${error.message}`];
    return result;
  }
}

function _compareResultsInternal(responseMap, poolMap, method, result) {

  // Count successful responses
  let successCount = 0;
  for (const [_, data] of responseMap) {
    if (data.status === 'success') {
      successCount++;
    }
  }

  // If not all responses are successful, return with resultsMatch = true
  if (successCount !== responseMap.size) {
    result.resultsMatch = true;
    return result;
  }

  // Convert responseMap to array of responses (only successful ones)
  const responses = Array.from(responseMap.entries())
    .filter(([_, data]) => data.status === 'success' && data.response?.result !== undefined)
    .map(([clientId, data]) => ({
      clientId,
      data: data.response.result
    }));

  // If we don't have enough responses to compare, return with resultsMatch = true
  // (nothing to compare means no mismatch detected)
  if (responses.length < 2) {
    result.resultsMatch = true;
    return result;
  }

  // Check if responses are objects or simple values
  const isObjectResponse = responses.some(r => typeof r.data === 'object' && r.data !== null);

  if (!isObjectResponse) {
    // Handle simple value comparison
    const valueCounts = new Map();
    responses.forEach(response => {
      const value = safeStringify(normalizeJSON(response.data));
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
    });
    
    let majorityValue;
    let maxCount = 0;
    
    for (const [value, count] of valueCounts) {
      if (count > maxCount) {
        maxCount = count;
        majorityValue = value;
      }
    }

    // Check if there's a clear majority (more than half)
    if (maxCount <= responses.length / 2) {
      result.mismatchedNode = 'nan';
      result.mismatchedOwner = 'nan';
      result.mismatchedResults = responses.map(r => `result: ${safeStringify(r.data)}`);
      return result;
    }

    const mismatchedResponse = responses.find(r => safeStringify(normalizeJSON(r.data)) !== majorityValue);
    if (mismatchedResponse) {
      result.resultsMatch = false;
      const poolMapEntry = poolMap.get(mismatchedResponse.clientId);
      result.mismatchedNode = poolMapEntry?.id || 'unknown';
      result.mismatchedOwner = poolMapEntry?.owner || 'unknown';
      result.mismatchedResults = [`result: ${safeStringify(mismatchedResponse.data)}`];
      
      // Send Telegram alert for simple value mismatch
      const alertMessage = `\n------------------------------------------\n🚨 RPC Response Mismatch Detected!\n\nMethod: ${method}\nMismatched Node: ${result.mismatchedNode}\nNode Owner: ${result.mismatchedOwner}\nMismatch Details: ${result.mismatchedResults.join('\n')}`;
      try {
        sendTelegramAlert(alertMessage);
      } catch (telegramError) {
        console.error("❌ Error sending telegram alert:", telegramError.message);
      }
    } else {
      result.resultsMatch = true;
    }
    return result;
  }

  // Handle object/array comparison
  // For arrays, compare the entire structure as a single unit
  // For objects, compare by keys
  
  if (Array.isArray(responses[0].data)) {
    // All responses should be arrays - compare them as complete structures
    const valueCounts = new Map();
    responses.forEach(response => {
      const value = safeStringify(normalizeJSON(response.data));
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
    });
    
    let majorityValue;
    let maxCount = 0;
    
    for (const [value, count] of valueCounts) {
      if (count > maxCount) {
        maxCount = count;
        majorityValue = value;
      }
    }

    if (maxCount <= responses.length / 2) {
      result.mismatchedNode = 'nan';
      result.mismatchedOwner = 'nan';
      result.mismatchedResults = responses.map(r => `result: ${safeStringify(r.data)}`);
      return result;
    }

    const mismatchedResponse = responses.find(r => safeStringify(normalizeJSON(r.data)) !== majorityValue);
    if (mismatchedResponse) {
      result.resultsMatch = false;
      const poolMapEntry = poolMap.get(mismatchedResponse.clientId);
      result.mismatchedNode = poolMapEntry?.id || 'unknown';
      result.mismatchedOwner = poolMapEntry?.owner || 'unknown';
      result.mismatchedResults = [`result: ${safeStringify(mismatchedResponse.data)}`];
      
      // Send Telegram alert for array mismatch
      const alertMessage = `\n------------------------------------------\n🚨 RPC Response Mismatch Detected!\n\nMethod: ${method}\nMismatched Node: ${result.mismatchedNode}\nNode Owner: ${result.mismatchedOwner}\nMismatch Details: ${result.mismatchedResults.join('\n')}`;
      try {
        sendTelegramAlert(alertMessage);
      } catch (telegramError) {
        console.error("❌ Error sending telegram alert:", telegramError.message);
      }
    } else {
      result.resultsMatch = true;
    }
    return result;
  }

  // Handle object comparison by keys
  // Find common keys across all responses
  const commonKeys = new Set();
  let firstIteration = true;

  try {
    responses.forEach(response => {
      if (!response.data || typeof response.data !== 'object') return;
      
      const currentKeys = new Set(Object.keys(response.data));
      
      if (firstIteration) {
        currentKeys.forEach(key => commonKeys.add(key));
        firstIteration = false;
      } else {
        // Keep only keys that exist in all responses
        for (const key of commonKeys) {
          if (!currentKeys.has(key)) {
            commonKeys.delete(key);
          }
        }
      }
    });
  } catch (error) {
    console.error('Error finding common keys:', error.message);
    result.resultsMatch = true; // If we can't compare, assume they match
    return result;
  }

  // Compare each key across all responses
  const keyMismatches = new Map(); // key -> Set of unique values
  
  try {
    for (const key of commonKeys) {
      const keyValues = new Set();
      responses.forEach(response => {
        // Normalize the value before stringifying to handle different key ordering
        const normalizedValue = normalizeJSON(response.data[key]);
        keyValues.add(safeStringify(normalizedValue));
      });
      
      if (keyValues.size > 1) {
        keyMismatches.set(key, keyValues);
      }
    }
  } catch (error) {
    console.error('Error comparing keys:', error.message);
    result.resultsMatch = true; // If we can't compare, assume they match
    return result;
  }

  if (keyMismatches.size > 0) {
    result.resultsMatch = false;
    
    try {
      // Find the first response that differs for any mismatched key
      for (const [key, values] of keyMismatches) {
        const valuesArray = Array.from(values);
        if (valuesArray.length === 0) continue;
        
        const valueCounts = valuesArray
          .map(v => ({ 
            value: v, 
            count: responses.filter(r => safeStringify(normalizeJSON(r.data[key])) === v).length 
          }))
          .sort((a, b) => b.count - a.count);
        
        if (valueCounts.length === 0) continue;
        const majorityValue = valueCounts[0].value;
        
        const mismatchedResponse = responses.find(r => safeStringify(normalizeJSON(r.data[key])) !== majorityValue);
        if (mismatchedResponse) {
          const poolMapEntry = poolMap.get(mismatchedResponse.clientId);
          result.mismatchedNode = poolMapEntry?.id || 'unknown';
          result.mismatchedOwner = poolMapEntry?.owner || 'unknown';
          break;
        }
      }
    } catch (error) {
      console.error('Error finding mismatched node:', error.message);
    }
    
    // Format mismatched results to show key-specific differences
    result.mismatchedResults = Array.from(keyMismatches.entries()).map(([key, values]) => 
      `key "${key}": ${Array.from(values).join(' vs ')}`
    );

    // Send Telegram alert for object mismatch
    const alertMessage = `\n------------------------------------------\n🚨 RPC Response Mismatch Detected!\n\nMethod: ${method}\nMismatched Node: ${result.mismatchedNode}\nNode Owner: ${result.mismatchedOwner}\nMismatch Details:\n${result.mismatchedResults.join('\n')}`;
    try {
      sendTelegramAlert(alertMessage);
    } catch (telegramError) {
      console.error("❌ Error sending telegram alert:", telegramError.message);
    }
  } else {
    result.resultsMatch = true;
  }

  return result;
}

module.exports = { compareResults };
