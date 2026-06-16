---
name: convert-tests
description: Convert XWiki unit tests to JUnit5/Mockito and normalize style. Handles JUnit4, JMock, MockitoComponentMockingRule, and style cleanup of existing JUnit5 tests. For converting functional IT tests to the Docker framework, use the convert-tests-docker skill.
---

# Converting XWiki tests to JUnit5 + Mockito

Use this skill when converting existing **unit tests** that use JUnit4 (`@Before`, `@Test` from `org.junit`) and/or JMock (`AbstractMockingComponentTestCase`, `getMockery()`, `Expectations`) or `MockitoComponentMockingRule` to JUnit5 + Mockito.

**For converting functional IT tests** (browser-based tests using `getUtil()`, `AbstractAuthenticatedTest`, page objects) to the JUnit5 Docker framework (`@UITest`), use the **`convert-tests-docker`** skill instead.

## Code style rules to apply during conversion

These apply to every file touched:

* Remove `public` from class declaration and all method declarations (classes and methods are package-private by default in test files).
* Add `this.` prefix to all instance field accesses.
* Remove `throws Exception` from method signatures unless it is actually necessary (see "checked exceptions" section below).
* Remove the `test` prefix from test method names (`testFoo` → `foo`).
* Normalize method names to proper camelCase (e.g. `handlecustomContentType` → `handleCustomContentType`, `getURLerror` → `getURLError`).
* Replace `Arrays.asList(...)` with `List.of(...)`, `Collections.emptyList()` with `List.of()`, `Collections.emptySet()` with `Set.of()`, `Collections.singleton(x)` with `Set.of(x)`.
* Replace `new ArrayList<>(); list.add(...)` patterns with `List.of(...)` where the list is not mutated.
* Replace `list.get(0)` with `list.getFirst()` and `list.get(list.size() - 1)` with `list.getLast()` (Java 21+).
* Use static imports for all assertions (`assertEquals`, `assertTrue`, etc.) from `org.junit.jupiter.api.Assertions`.
* Use text blocks for multiline strings.
* Keep ALL existing comments — do NOT remove inline comments, block comments, or Javadoc during conversion. No exceptions without explicit user confirmation.
* Remove field-level Javadoc that only restates the field name or type (e.g. `/** The execution context. */` on an `ExecutionContext` field) — keep it only when the comment adds genuine domain information.
* Wrap lines to a maximum of 120 characters. For fluent chains (`.thenReturn(...)`, `.thenThrow(...)`), break before the `.`; for method arguments, break after the last argument that fits and indent the continuation by 4 spaces.

## JUnit4 → JUnit5 annotation mapping

| JUnit4 | JUnit5 |
|--------|--------|
| `import org.junit.Test` | `import org.junit.jupiter.api.Test` |
| `@Before` | `@BeforeEach` |
| `@After` | `@AfterEach` |
| `@BeforeClass` | `@BeforeAll` |
| `@AfterClass` | `@AfterAll` |
| `@Ignore` | `@Disabled` |
| `Assert.assertEquals(...)` | `assertEquals(...)` (static import) |
| `Assert.assertTrue(...)` | `assertTrue(...)` (static import) |

## MockitoRepositoryUtilsRule → JUnit5

`MockitoRepositoryUtilsRule` is a JUnit4 `@Rule` that sets up a full extension repository environment with a `MockitoComponentManager`.

**Before:**
```java
@AllComponents
public class FooTest
{
    @Rule
    public MockitoRepositoryUtilsRule repositoryUtil = new MockitoRepositoryUtilsRule();

    @AfterComponent
    public void afterComponent() throws Exception
    {
        SomeDep mock = this.repositoryUtil.getComponentManager().registerMockComponent(SomeDep.class);
        doThrow(SomeException.class).when(mock).someMethod(any());
    }

    @Before
    public void before() throws Exception
    {
        this.dep = this.repositoryUtil.getComponentManager().getInstance(SomeDep.class);
    }
}
```

**After:**
```java
@ComponentTest
@AllComponents
@ExtendWith(MockitoRepositoryUtilsExtension.class)
class FooTest
{
    @InjectComponentManager
    private MockitoComponentManager componentManager;

    @AfterComponent
    void afterComponent() throws Exception
    {
        SomeDep mock = this.componentManager.registerMockComponent(SomeDep.class);
        doThrow(SomeException.class).when(mock).someMethod(any());
    }

    @BeforeEach
    void before() throws Exception
    {
        this.dep = this.componentManager.getInstance(SomeDep.class);
    }
}
```

Key points:
* `@ComponentTest` is required — `MockitoRepositoryUtilsExtension` depends on `MockitoComponentManagerExtension` running first.
* `@AllComponents` stays on the class (it was on the original).
* All `repositoryUtil.getComponentManager()` calls become `this.componentManager`.
* `@AfterComponent` and its content are preserved as-is (just remove `public`).

## MockitoComponentMockingRule → JUnit5

`MockitoComponentMockingRule` is a JUnit4 rule that auto-mocks all dependencies of a component. It is **lazy**: the component under test is created on the first call to `getComponentUnderTest()`, so any `registerMockComponent()` calls made before that call are available at injection time.

**Before:**
```java
public class FooTest
{
    @Rule
    public MockitoComponentMockingRule<Foo> mocker = new MockitoComponentMockingRule<>(Foo.class);

    @Test
    public void doSomething() throws Exception
    {
        BarDep bar = mocker.getInstance(BarDep.class);
        when(bar.compute()).thenReturn(42);
        assertEquals(42, mocker.getComponentUnderTest().work());
    }
}
```

**After:**
```java
@ComponentTest
class FooTest
{
    @InjectMockComponents
    private Foo foo;

    @MockComponent
    private BarDep bar;

    @Test
    void doSomething()
    {
        when(this.bar.compute()).thenReturn(42);
        assertEquals(42, this.foo.work());
    }
}
```

### Mapping rules

| `MockitoComponentMockingRule` | JUnit5 equivalent |
|-------------------------------|-------------------|
| `mocker.getComponentUnderTest()` | `@InjectMockComponents` field |
| `mocker.getInstance(Type.class)` | `@MockComponent private Type type` |
| `mocker.getInstance(Type.class, "hint")` | `@MockComponent @Named("hint") private Type type` |
| `mocker.getInstance(new DefaultParameterizedType(null, X.class, T.class))` | `@MockComponent private X<T> field` |
| `mocker.registerMockComponent(Type.class)` — needed at injection time | `@MockComponent` field + `@BeforeComponent` to stub |
| `mocker.registerMockComponent(Type.class)` — needed only at execution time | `@InjectComponentManager` + `componentManager.registerMockComponent(...)` in test/helper method |

### Dropping `@BeforeEach` when only field assignments remain

When the JUnit4 `@Before` method only assigns local fields from `mocker.getInstance()` / `mocker.getComponentUnderTest()` (no stubs), the entire `@BeforeEach` can be removed — `@MockComponent` and `@InjectMockComponents` handle the wiring automatically.

### Abstract test base classes

An abstract class annotated with `@ComponentTest` can hold shared `@MockComponent` fields and `@BeforeEach` setup. Concrete subclasses extend it, add their own `@InjectMockComponents` / `@MockComponent` fields, and call `super.beforeEach()` from their own `@BeforeEach`.

### Lazy vs eager injection — the key pitfall

`MockitoComponentMockingRule` creates the component lazily (on first `getComponentUnderTest()`). Setup code often calls `registerMockComponent()` before `getComponentUnderTest()`, so those mocks are available during component injection.

`@InjectMockComponents` is **eager** — the component is created before any test method runs. If a dependency must be registered before injection (e.g. `@Named("context") Provider<ComponentManager>`), use `@BeforeComponent`:

```java
@MockComponent
@Named("context")
private Provider<ComponentManager> componentManagerProvider;

@BeforeComponent
void beforeComponent(MockitoComponentManager cm)
{
    when(this.componentManagerProvider.get()).thenReturn(cm);
}
```

For dependencies only needed during test execution (e.g. registered in a per-test `setUp()` helper), add `@InjectComponentManager` and call `registerMockComponent()` in the test method or helper — this is safe because injection already completed:

```java
@InjectComponentManager
private MockitoComponentManager componentManager;

private void setUp(...) throws Exception
{
    Provider<XWikiContext> ctx = this.componentManager.registerMockComponent(XWikiContext.TYPE_PROVIDER);
    when(ctx.get()).thenReturn(xcontext);
    ...
}
```

## JMock → Mockito: test class structure

**Before (JMock):**
```java
@AllComponents
@MockingRequirement(value = MyComponent.class, exceptions = { SomeResolver.class })
public class MyComponentTest extends AbstractMockingComponentTestCase<MyInterface>
{
    private SomeDep dep;

    @Before
    public void configure() throws Exception
    {
        dep = getComponentManager().getInstance(SomeDep.class);
        getMockery().checking(new Expectations() {{
            allowing(dep).someMethod();
            will(returnValue("value"));
        }});
    }

    @Test
    public void testSomething() throws Exception
    {
        Assert.assertEquals("value", getMockedComponent().doWork());
    }
}
```

**After (Mockito):**
```java
@ComponentTest
class MyComponentTest
{
    @InjectMockComponents
    private MyComponent myComponent;

    @MockComponent
    private SomeDep dep;

    @BeforeEach
    void configure()
    {
        when(this.dep.someMethod()).thenReturn("value");
    }

    @Test
    void something()
    {
        assertEquals("value", this.myComponent.doWork());
    }
}
```

Key points:
* `getMockedComponent()` → the `@InjectMockComponents` field.
* `@MockingRequirement(exceptions = X.class)` means X is NOT mocked in JMock — it uses a real implementation registered via `@ComponentList`. In the Mockito test, keep it that way: do NOT add a `@MockComponent` for it; the `@ComponentList` entry provides it.
* All components that were looked up via `getComponentManager().getInstance(...)` become `@MockComponent` fields.
* The test class no longer extends anything.
* `@AllComponents` and `@MockingRequirement` are dropped entirely.

## IDE "never assigned" warning

Fields annotated with `@InjectMockComponents` or `@MockComponent` are assigned by the test framework via reflection, not by Java code. IDEs will warn `Private field 'x' is never assigned` — this is expected and harmless. No suppression annotation is needed.

## JMock Expectations → Mockito stubs

| JMock | Mockito |
|-------|---------|
| `allowing(mock).method(); will(returnValue(x))` | `when(mock.method()).thenReturn(x)` |
| `oneOf(mock).method(); will(returnValue(x))` | `when(mock.method()).thenReturn(x)` (use `verify()` if you need to assert it was called exactly once) |
| `oneOf(mock).method(); will(throwException(e))` | `when(mock.method()).thenThrow(e)` |
| `getMockery().mock(SomeClass.class)` | `mock(SomeClass.class)` (static import from `org.mockito.Mockito`) |
| `getMockery().mock(SomeClass.class, "label")` | `mock(SomeClass.class, "label")` |
| `getMockery().sequence("name")` / `inSequence(...)` | Drop — Mockito stubs match by argument, not by call order; rearrange test to make ordering implicit via assertions |

## Strict stubbing and `@BeforeEach` setup

`@ComponentTest` uses Mockito LENIENT mode by default, so `@MockitoSettings(strictness = Strictness.LENIENT)` is always redundant on `@ComponentTest` classes — always remove it. Only add it if a class does NOT use `@ComponentTest` and has legitimately unused stubs from a shared `@BeforeEach`.

## Exception assertions

Replace try/catch + boolean/assertNotNull patterns with `assertThrows`:

```java
// Before
boolean exceptionCaught = false;
try { foo.bar(); } catch (FooException e) { exceptionCaught = true; }
assertTrue(exceptionCaught);

// After
assertThrows(FooException.class, () -> foo.bar());
```

When you also need to inspect the exception:
```java
FooException e = assertThrows(FooException.class, () -> foo.bar());
assertEquals("expected message", e.getMessage());
```

## Checked exceptions and `throws Exception`

If a mocked method declares a checked exception (e.g. `exists(DocumentReference) throws Exception`), calling it inside `when(mock.exists(...))` requires the surrounding method to declare `throws Exception` (Java enforces this at compile time regardless of whether the mock actually throws). Keep `throws Exception` only when at least one such call is present in the method; otherwise remove it.

Also: `componentManager.registerMockComponent(...)` and `componentManager.getInstance(...)` themselves declare `throws Exception`. Any test method that calls these needs `throws Exception` even if it has no other checked calls.

## Critical pitfall: never call a mock inside `when()`

**Wrong — causes `UnfinishedStubbingException`:**
```java
when(resolver.resolve("Foo", mockDoc.getDocumentReference())).thenReturn(ref);
//                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                              calling mockDoc inside when() confuses Mockito's recorder
```

**Correct — extract the value first:**
```java
DocumentReference docRef = mockDoc.getDocumentReference(); // or use a stored constant/field
when(resolver.resolve("Foo", docRef)).thenReturn(ref);
```

This applies to any mock method call appearing as an argument to `when(...)`. Calls inside `thenReturn(...)` are generally safe, but extracting them to a variable is clearer.

The same issue arises when the value is fixed across all tests — prefer a `private static final` constant:
```java
private static final DocumentReference DOCUMENT_REFERENCE = new DocumentReference("wiki", "Space", "Page");
```
Then use `DOCUMENT_REFERENCE` directly in stubs.

## Generic component mocks

Generic components such as `DocumentReferenceResolver<String>` or `EntityReferenceSerializer<String>` are mocked with their generic type preserved:
```java
@MockComponent
private DocumentReferenceResolver<String> documentReferenceResolver;
```
Mock ALL injected dependencies of the component under test, including ones that appear unused in the test, to avoid injection failures. Logger is auto-provided — do NOT add `@MockComponent Logger logger`. If the production code logs and the test needs to verify log output (or suppress console noise), use `LogCaptureExtension`:

```java
@RegisterExtension
private final LogCaptureExtension logCapture = new LogCaptureExtension(LogLevel.ERROR);

// In the test:
assertEquals("expected message text", this.logCapture.getMessage(0));
```

`logCapture.getMessage(0)` returns the raw SLF4J message with NO level prefix. To find the expected value, run the test without the assertion first and copy the actual output.

## Named component mocks

Use `@Named` on `@MockComponent` to match `@Named` on the production component's injection:
```java
@MockComponent
@Named("document")
private SheetBinder documentSheetBinder;
```

## MockitoComponentManagerRule → JUnit5

`MockitoComponentManagerRule` provides a full `MockitoComponentManager` (unlike `MockitoComponentMockingRule` which scopes to one component). Used with `@AllComponents`.

**Before:**
```java
@AllComponents
public class FooTest
{
    @Rule
    public MockitoComponentManagerRule componentManagerRule = new MockitoComponentManagerRule();

    private ResourceReferenceParser parser;

    @Before
    public void setUp() throws Exception
    {
        this.parser = this.componentManagerRule.getInstance(ResourceReferenceParser.class, "link");
    }
}
```

**After:**
```java
@ComponentTest
@AllComponents
class FooTest
{
    @InjectComponentManager
    private MockitoComponentManager componentManager;

    private ResourceReferenceParser parser;

    @BeforeEach
    void setUp() throws Exception
    {
        this.parser = this.componentManager.getInstance(ResourceReferenceParser.class, "link");
    }
}
```

Key point: no `@ExtendWith` needed — `@ComponentTest` already sets up `MockitoComponentManagerExtension`.

## Hamcrest → JUnit5 assertions

| Hamcrest | JUnit5 |
|----------|--------|
| `assertThat(obj, equalTo(other))` | `assertEquals(other, obj)` |
| `assertThat(obj, sameInstance(other))` | `assertSame(other, obj)` |
| `assertThat(arr, equalTo(arr2))` (byte[]) | `assertArrayEquals(arr2, arr)` |
| `assertThat(arr, not(equalTo(arr2)))` (byte[]) | `assertFalse(Arrays.equals(arr, arr2))` |

## Mockito Answer: anonymous class → lambda

```java
// Before
doAnswer(new Answer<Void>() {
    @Override public Void answer(InvocationOnMock inv) throws IOException {
        OutputStream out = inv.getArgument(0);
        out.write(data);
        return null;
    }
}).when(mock).method(any());

// After
doAnswer(invocation -> {
    OutputStream out = invocation.getArgument(0);
    out.write(data);
    return null;
}).when(mock).method(any());
```

## Argument matchers

When mixing exact values and matchers, ALL arguments in the same `when()` call must use matchers:
```java
// Wrong — mixes raw value and matcher
when(resolver.resolve("XWiki.SomeClass", any(DocumentReference.class))).thenReturn(ref);

// Correct — wrap the raw value with eq()
when(resolver.resolve(eq("XWiki.SomeClass"), any(DocumentReference.class))).thenReturn(ref);
```

## POM changes

1. Remove `xwiki-commons-tool-test-jmock` test dependency.
2. Keep `xwiki-commons-tool-test-component` — it transitively provides Mockito.

```xml
<!-- Remove this -->
<dependency>
  <groupId>org.xwiki.commons</groupId>
  <artifactId>xwiki-commons-tool-test-jmock</artifactId>
  <version>${commons.version}</version>
  <scope>test</scope>
</dependency>
```

## Post-conversion checklist

1. Remove unused imports from every converted file (JMock, JUnit4, Hamcrest, and any other imports no longer referenced after conversion).
2. Run `mvn clean verify` on the module (skip checkstyle/revapi/console-capture as needed). All tests must pass.
3. Check the jacoco threshold: run with `-Pquality -Dxwiki.jacoco.instructionRatio=1.00`. The failure output shows the current coverage ratio. If it is higher than the value in `<xwiki.jacoco.instructionRatio>`, update the POM property.
