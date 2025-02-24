function compareResults(responseMap, poolMap) {
  // Initialize return object
  const result = {
    resultsMatch: false,
    mismatchedNode: 'nan',
    mismatchedOwner: 'nan',
    mismatchedResults: []
  };

  // First check if any response has an invalid status or timeout
  for (const [_, data] of responseMap) {
    if (data.status === 'invalid' || data.status === 'timeout') {
      result.resultsMatch = false;
      return result;
    }
  }

  // Convert responseMap to array of responses
  const responses = Array.from(responseMap.entries()).map(([clientId, data]) => ({
    clientId,
    data: data.status === 'success' ? data.response?.result : 
          data.status === 'error' ? data.response?.error : 
          undefined
  })).filter(r => r.data !== undefined); // Filter out any undefined results

  // If we don't have enough responses to compare, return default result
  if (responses.length < 2) {
    return result;
  }

  // Check if responses are objects or simple values
  const isObjectResponse = responses.some(r => typeof r.data === 'object' && r.data !== null);

  if (!isObjectResponse) {
    // Handle simple value comparison (original logic)
    const valueCounts = new Map();
    responses.forEach(response => {
      const value = JSON.stringify(response.data);
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
      result.mismatchedResults = responses.map(r => `result: ${JSON.stringify(r.data)}`);
      return result;
    }

    const mismatchedResponse = responses.find(r => JSON.stringify(r.data) !== majorityValue);
    if (mismatchedResponse) {
      result.resultsMatch = false;
      const poolMapEntry = poolMap.get(mismatchedResponse.clientId);
      result.mismatchedNode = poolMapEntry?.id || 'unknown';
      result.mismatchedOwner = poolMapEntry?.owner || 'unknown';
      result.mismatchedResults = [`result: ${JSON.stringify(mismatchedResponse.data)}`];
    } else {
      result.resultsMatch = true;
    }
    return result;
  }

  // Handle object comparison
  // Find common keys across all responses
  const commonKeys = new Set();
  let firstIteration = true;

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

  // Compare each key across all responses
  const keyMismatches = new Map(); // key -> Set of unique values
  
  for (const key of commonKeys) {
    const keyValues = new Set();
    responses.forEach(response => {
      keyValues.add(JSON.stringify(response.data[key]));
    });
    
    if (keyValues.size > 1) {
      keyMismatches.set(key, keyValues);
    }
  }

  if (keyMismatches.size > 0) {
    result.resultsMatch = false;
    // Find the first response that differs for any mismatched key
    for (const [key, values] of keyMismatches) {
      const majorityValue = Array.from(values)
        .map(v => ({ value: v, count: responses.filter(r => JSON.stringify(r.data[key]) === v).length }))
        .sort((a, b) => b.count - a.count)[0].value;
      
      const mismatchedResponse = responses.find(r => JSON.stringify(r.data[key]) !== majorityValue);
      if (mismatchedResponse) {
        const poolMapEntry = poolMap.get(mismatchedResponse.clientId);
        result.mismatchedNode = poolMapEntry?.id || 'unknown';
        result.mismatchedOwner = poolMapEntry?.owner || 'unknown';
        break;
      }
    }
    
    // Format mismatched results to show key-specific differences
    result.mismatchedResults = Array.from(keyMismatches.entries()).map(([key, values]) => 
      `key "${key}": ${Array.from(values).join(' vs ')}`
    );
  } else {
    result.resultsMatch = true;
  }

  return result;
}

module.exports = { compareResults };
