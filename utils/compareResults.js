function compareResults(responseMap, poolMap) {
  // Initialize return object
  const result = {
    resultsMatch: false,
    mismatchedNode: 'nan',
    mismatchedOwner: 'nan',
    mismatchedResults: []
  };

  // First check if any response has an error status
  for (const [_, response] of responseMap) {
    if (response.status === 'error' || response.status === 'timeout') {
      result.resultsMatch = false;
      return result;
    }
  }

  // Convert responseMap to array of responses
  const responses = Array.from(responseMap.entries()).map(([clientId, data]) => ({
    clientId,
    data: data.result // Extract just the result from the response data
  })).filter(r => r.data !== undefined); // Filter out any undefined results

  // If we don't have enough responses to compare, return default result
  if (responses.length < 2) {
    return result;
  }

  // Find the majority value for each key/path
  function findMajorityValue(responses) {
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
    
    return { majorityValue, maxCount };
  }

  // Get the majority value
  const { majorityValue, maxCount } = findMajorityValue(responses);

  // If there's no clear majority, all values are mismatches
  if (maxCount <= responses.length / 2) {
    result.mismatchedNode = 'nan';
    result.mismatchedOwner = 'nan';
    result.mismatchedResults = responses.map(r => `result: ${JSON.stringify(r.data)}`);
    return result;
  }

  // Find the response that doesn't match the majority
  const mismatchedResponse = responses.find(r => JSON.stringify(r.data) !== majorityValue);
  
  // If we found a mismatched response
  if (mismatchedResponse) {
    result.resultsMatch = false;
    // Get the machine ID and owner from poolMap using the websocket ID
    const poolMapEntry = poolMap.get(mismatchedResponse.clientId);
    result.mismatchedNode = poolMapEntry?.id || 'unknown';
    result.mismatchedOwner = poolMapEntry?.owner || 'unknown';
    result.mismatchedResults = [`result: ${JSON.stringify(mismatchedResponse.data)}`];
  } else {
    result.resultsMatch = true;
  }

  return result;
}

module.exports = { compareResults };
