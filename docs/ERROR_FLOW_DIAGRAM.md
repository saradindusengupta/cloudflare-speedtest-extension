# Error Handling Flow Diagram

## Test Execution Flow with Error Handling

```
User Clicks "Test Speed"
         |
         v
[Check navigator.onLine]
         |
    [Offline?] --Yes--> Show "No internet connection" --> END
         |
        No
         |
         v
[Start Speed Test]
         |
         v
[Test Running...]
         |
    +---------+---------+
    |                   |
   Pass                Error
    |                   |
    v                   v
[Complete]      [Categorize Error]
    |                   |
    v              +-----------+----------+
[Save to         |           |           |
 Storage]     Network    Rate Limit    Other
    |              |           |           |
    v              v           v           v
[Show Results] [Retry?]   [Retry?]    [Show Error]
                  |           |
             +----+----+  +---+---+
             |         |  |       |
          Retry<3   Max  Retry<3  Max
             |      Retries |    Retries
             v         |    v       |
    [Wait + Retry]    |  [Wait]    |
             |         |    |       |
             +---------+    +-------+
                      |            |
                      v            v
              [Back to Start] [Show Error]
```

## Error Categorization Flow

```
[Error Occurred]
       |
       v
[Analyze error.message]
       |
   +---+---+---+---+---+
   |   |   |   |   |   |
   v   v   v   v   v   v
Network Rate Security Offline CORS Unknown
   |   |   |   |   |   |
   +---+---+---+---+---+
           |
           v
  [Map to User Message]
           |
           v
  [Determine if Retryable]
           |
      +----+----+
      |         |
  Retryable  Non-Retryable
      |         |
      v         v
 [Retry Logic] [Show Error + END]
```

## Storage Validation Flow

```
[Read from chrome.storage.local]
           |
           v
  [chrome.runtime.lastError?]
           |
      +----+----+
      |         |
     Yes        No
      |         |
      v         v
 [Log Error] [Validate Data]
      |         |
      +----+----+
           |
           v
    [Is Array?]
           |
      +----+----+
      |         |
     Yes        No
      |         |
      v         v
 [Filter     [Reset to
  Valid       Empty
  Items]      Array]
      |         |
      +----+----+
           |
           v
 [Clean up if needed]
           |
           v
  [Use validated data]
```

## Network Status Monitoring

```
[Extension Starts]
       |
       +---> [Check navigator.onLine]
       |             |
       |        +----+----+
       |        |         |
       |      Online   Offline
       |        |         |
       |        v         v
       |   [Enable    [Disable
       |    Button]    Button]
       |
       +---> [Listen for 'online' event]
       |             |
       |             v
       |     [Connection Restored]
       |             |
       |             v
       |     [Update UI + Reload IP]
       |
       +---> [Listen for 'offline' event]
                     |
                     v
             [Connection Lost]
                     |
                     v
             [Update UI + Stop Test]
```

## Retry Logic with Exponential Backoff

```
[Error Occurs]
       |
       v
[Is Retryable?] --No--> [Show Error] --> END
       |
      Yes
       |
       v
[retryCount < maxRetries?] --No--> [Show Error] --> END
       |
      Yes
       |
       v
[Calculate Delay]
delay = 1000ms * 2^(retryCount-1)
       |
       v
[Increment retryCount]
       |
       v
[Show "Retrying in Xs..."]
       |
       v
[Wait for delay]
       |
       v
[Retry Test] --> Back to test execution
```

## Example Scenarios

### Scenario 1: Successful Test
```
User Click --> Online Check --> Start Test --> Progress Updates --> Complete --> Save --> Show Results
```

### Scenario 2: Network Failure with Retry
```
User Click --> Online Check --> Start Test --> Network Error --> 
Retry 1 (1s delay) --> Network Error --> 
Retry 2 (2s delay) --> Network Error --> 
Retry 3 (4s delay) --> Success --> Save --> Show Results
```

### Scenario 3: Rate Limiting
```
User Click --> Online Check --> Start Test --> HTTP 429 --> 
Retry 1 (1s delay) --> HTTP 429 --> 
Retry 2 (2s delay) --> Success --> Save --> Show Results
```

### Scenario 4: Persistent Failure
```
User Click --> Online Check --> Start Test --> Error --> 
Retry 1 --> Error --> 
Retry 2 --> Error --> 
Retry 3 --> Error --> 
Max Retries Exceeded --> Show "Test failed. Please try again."
```

### Scenario 5: Offline Detection
```
User Click --> Online Check (OFFLINE) --> Show "No internet connection" --> 
[Network Restored] --> "Connection restored" --> Ready for test
```

### Scenario 6: Corrupted Storage Data
```
Load History --> Read Storage --> Validate Data --> 
Found 3 items: [valid, corrupted, valid] --> 
Filter --> 2 valid items remain --> 
Update Storage (remove corrupted) --> 
Display 2 items
```
