# opspec Grammar — Formal Specification

Version 1.0

## 1. Annotation Syntax

Specifications are written as triple-slash comments (`///`) directly in AssemblyScript source files, or inside JSDoc `/** */` blocks. Each annotation follows this format:

```
/// @<tag> <expression>  // optional comment
```

Or inside JSDoc:
```
/**
 * @<tag> <expression>  // optional comment
 */
```

## 2. Tags

### 2.1 Contract-Level Tags

These are placed before a class declaration:

| Tag | Scope | Description |
|-----|-------|-------------|
| `@invariant` | Contract | Property that must hold for all reachable states |
| `@state` | Contract | State machine transition definition |
| `@opnet` | Contract | OPNet-specific constraint |

### 2.2 Method-Level Tags

These are placed before a method declaration:

| Tag | Scope | Description |
|-----|-------|-------------|
| `@pre` | Method | Precondition (must be true when method is called) |
| `@requires` | Method | Alias for `@pre` |
| `@post` | Method | Postcondition (must be true when method returns) |
| `@ensures` | Method | Alias for `@post`, or CEI enforcement when value is `CEI` |
| `@access` | Method | Access control level |
| `@calls` | Method | Cross-contract call specification |
| `@temporal` | Method | Temporal/block property |

## 3. Expression Language

### 3.1 Field References

```
this.<fieldName>.value              — Current value of a stored field
old(this.<fieldName>.value)         — Value at method entry (postconditions only)
return.<method>()                   — Return value of the method
```

### 3.2 Types

The spec expression language understands OPNet primitives:

| Type | Operators | Literals |
|------|-----------|----------|
| `u256` | `==`, `!=`, `>`, `<`, `>=`, `<=`, `+`, `-`, `*`, `/` | `u256.Zero`, `u256.One`, `u256.fromU32(n)` |
| `Address` | `==`, `!=`, `.isZero()`, `.equals()` | `Address.zero()` |
| `bool` | `==`, `!=`, `!`, `&&`, `\|\|`, `implies` | `true`, `false` |

### 3.3 Operators

Standard mathematical operators. Note: in spec expressions, you write math directly (e.g., `a >= b`) even though the code requires `SafeMath.add(a, b)`. Specs are mathematical, not code.

```
==, !=                      — Equality
>, <, >=, <=                — Comparison
+, -, *, /                  — Arithmetic (maps to SafeMath in code)
!, &&, ||                   — Boolean
implies                     — Logical implication (a implies b ≡ !a || b)
```

### 3.4 Built-in Functions

```
old(<expr>)                 — Pre-state value (postconditions only)
SafeMath.mul(a, b)          — Explicit SafeMath reference
SafeMath.add(a, b)
SafeMath.sub(a, b)
SafeMath.div(a, b)
```

### 3.5 Quantifiers (V2+)

Reserved for future versions:
```
forall i in range(0, n) : P(i)
exists i in range(0, n) : P(i)
```

## 4. Tag Grammars

### 4.1 @invariant

```
@invariant <boolean-expression>
```

Examples:
```
@invariant this.virtualPillReserve.value > u256.Zero
@invariant this.graduated.value == true implies this.realPillAccumulated.value >= this.graduationThreshold.value
@invariant this.k.value == SafeMath.mul(initialPillReserve, initialTokenReserve)
```

### 4.2 @pre / @requires

```
@pre <boolean-expression>  // "optional description"
@requires <boolean-expression>
```

Examples:
```
@pre !calldata.readU256().isZero()  // "Amount must be non-zero"
@pre !this.graduated.value           // "Token has not graduated"
@pre this.initialized.value          // "Contract is initialized"
```

### 4.3 @post / @ensures

```
@post <boolean-expression>
@ensures <boolean-expression>
@ensures CEI                         — Special: enforces Checks-Effects-Interactions pattern
```

Examples:
```
@post this.virtualPillReserve.value >= old(this.virtualPillReserve.value)
@post return.readU256() > u256.Zero
@ensures CEI
```

### 4.4 @state

```
@state <FromState> -> <ToState> : <method1>(), <method2>() [when <condition>]
```

State names can be prefixed with `!` for negation.

Examples:
```
@state UNINITIALIZED -> ACTIVE : setTokenAddress()
@state ACTIVE -> GRADUATED : buy() [when realPillAccumulated >= graduationThreshold]
@state !GRADUATED -> !GRADUATED : buy(), sell()
```

### 4.5 @access

```
@access <level>
```

Predefined levels:
- `deployer-only` — Only the contract deployer can call
- `owner-only` — Only the contract owner can call
- `anyone` — No access restrictions

Custom levels are allowed for future extensibility.

### 4.6 @calls

```
@calls <target> : <method>(<args>) -> <expectation>
```

Expectations:
- `must-succeed` — Call must succeed (check result.success, revert on failure)
- `may-fail` — Call may fail (error is handled)
- `unchecked` — Call result not checked (potential bug)

Examples:
```
@calls this.pillAddress.value : transferFrom(sender, this, amount) -> must-succeed
@calls FEE_DESTINATION : transfer(destination, fee) -> must-succeed
```

### 4.7 @temporal

```
@temporal <free-text-temporal-property>
```

Examples:
```
@temporal heartbeat() must be called within this.inactivityPeriod.value blocks
@temporal reservation expires after 5 blocks if not executed
```

Note: Temporal properties are informational in V1. Full verification requires runtime monitoring or model checking.

### 4.8 @opnet

```
@opnet <constraint-name>
```

Predefined constraints:
- `selectors-sha256` — All method selectors use SHA256 (encodeSelector)
- `csv-timelocks` — All swap addresses use CSV timelocks
- `address-two-params` — All Address.fromString() calls use 2 parameters
- `no-approve` — Use increaseAllowance, not approve

## 5. Verification Status

Each spec is verified with one of four outcomes:

| Status | Meaning |
|--------|---------|
| `VERIFIED` | Spec is satisfied by the code (static analysis confirms) |
| `UNVERIFIED` | Could not determine statically (needs manual review or symbolic execution) |
| `VIOLATED` | Code clearly violates the spec |
| `MISSING` | Spec references code structure that doesn't exist |

## 6. Notes

- The `old()` keyword in postconditions refers to the value of an expression at method entry. Full verification of `old()` requires symbolic execution (V2+).
- Invariants are checked against all methods that modify the referenced fields. Full invariant verification requires symbolic execution.
- State machine specs are structural in V1. Full state reachability analysis is a V2+ feature.
- The expression language is deliberately simple in V1 to get the syntax right. V2 will add quantifiers and richer expressions.
