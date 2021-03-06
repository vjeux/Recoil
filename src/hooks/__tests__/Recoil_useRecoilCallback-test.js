/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails oncall+perf_viz
 * @flow strict-local
 * @format
 */
'use strict';

const React = require('React');
const {useRef, useState} = require('React');
const {act} = require('ReactTestUtils');
const {
  atom,
  selector,
  useRecoilCallback,
  useSetRecoilState,
} = require('../../Recoil');
const invariant = require('../../lib/Recoil_invariant');
const {
  ReadsAtom,
  flushPromisesAndTimers,
  renderElements,
} = require('../../testing/Recoil_TestingUtils');

test('useRecoilCallback', () => {
  it('Reads Recoil values', async () => {
    const anAtom = atom({key: 'atom1', default: 'DEFAULT'});
    let pTest = Promise.reject(new Error("Callback didn't resolve"));
    let cb;

    function Component() {
      cb = useRecoilCallback(async ({getPromise}) => {
        // eslint-disable-next-line jest/valid-expect
        pTest = expect(getPromise(anAtom)).resolves.toBe('DEFAULT');
      });
      return null;
    }
    renderElements([<Component />]);
    act(cb);
    await pTest;
  });

  it('Can read Recoil values without throwing', async () => {
    const anAtom = atom({key: 'atom2', default: 123});
    const asyncSelector = selector({
      key: 'sel',
      get: () => {
        return new Promise(() => undefined);
      },
    });
    let didRun = false;
    let cb;

    function Component() {
      cb = useRecoilCallback(({getLoadable}) => {
        expect(getLoadable(anAtom)).toMatchObject({
          state: 'hasValue',
          contents: 123,
        });
        expect(getLoadable(asyncSelector)).toMatchObject({
          state: 'loading',
        });
        didRun = true; // ensure these assertions do get made
      });
      return null;
    }
    renderElements([<Component />]);
    act(cb);
    await flushPromisesAndTimers();
    expect(didRun).toBe(true);
  });

  it('Sets Recoil values (by queueing them)', async () => {
    const anAtom = atom({key: 'atom3', default: 'DEFAULT'});
    let cb;
    let pTest = Promise.reject(new Error("Callback didn't resolve"));

    function Component() {
      cb = useRecoilCallback(async ({getPromise, set}, value) => {
        set(anAtom, value);
        // eslint-disable-next-line jest/valid-expect
        pTest = expect(getPromise(anAtom)).resolves.toBe('DEFAULT');
      });
      return null;
    }

    const container = renderElements([
      <Component />,
      <ReadsAtom atom={anAtom} />,
    ]);
    expect(container.textContent).toBe('"DEFAULT"');
    act(() => cb(123));
    expect(container.textContent).toBe('123');
    await pTest;
  });

  it('Reset Recoil values', async () => {
    const anAtom = atom({key: 'atomReset', default: 'DEFAULT'});
    let setCB, resetCB;

    function Component() {
      setCB = useRecoilCallback(async ({set}, value) => set(anAtom, value));
      resetCB = useRecoilCallback(async ({reset}) => reset(anAtom));
      return null;
    }

    const container = renderElements([
      <Component />,
      <ReadsAtom atom={anAtom} />,
    ]);
    expect(container.textContent).toBe('"DEFAULT"');
    act(() => setCB(123));
    expect(container.textContent).toBe('123');
    act(resetCB);
    expect(container.textContent).toBe('"DEFAULT"');
  });

  it('Reads from a snapshot created at callback call time', async () => {
    const anAtom = atom({key: 'atom4', default: 123});
    let cb;
    let setter;
    let seenValue = null;

    let delay = () => new Promise(r => r()); // no delay initially

    function Component() {
      setter = useSetRecoilState(anAtom);
      cb = useRecoilCallback(async ({getPromise}) => {
        await delay();
        seenValue = await getPromise(anAtom);
      });
      return null;
    }

    // It sees an update flushed after the cb is created:
    renderElements([<Component />]);
    act(() => setter(345));
    act(cb);
    await flushPromisesAndTimers();
    expect(seenValue).toBe(345);

    // But does not see an update flushed while the cb is in progress:
    seenValue = null;
    let resumeCallback = () => invariant(false, 'must be initialized');
    delay = () => {
      return new Promise(resolve => {
        resumeCallback = resolve;
      });
    };
    act(cb);
    act(() => setter(678));
    await flushPromisesAndTimers();
    resumeCallback();
    await flushPromisesAndTimers();
    expect(seenValue).toBe(345);
  });
});

// Test that we always get a consistent instance of the callback function
// from useRecoilCallback() when it is memoizaed
test('Consistent callback function', () => {
  let setIteration;
  const Component = () => {
    const [iteration, _setIteration] = useState(0);
    setIteration = _setIteration;

    const callback = useRecoilCallback(() => {});
    const callbackRef = useRef(callback);
    iteration
      ? expect(callback).not.toBe(callbackRef.current)
      : expect(callback).toBe(callbackRef.current);

    const callbackMemoized = useRecoilCallback(() => {}, []);
    const callbackMemoizedRef = useRef(callbackMemoized);
    expect(callbackMemoized).toBe(callbackMemoizedRef.current);

    return iteration;
  };
  const out = renderElements(<Component />);
  expect(out.textContent).toBe('0');
  act(() => setIteration(1)); // Force a re-render of the Component
  expect(out.textContent).toBe('1');
});
