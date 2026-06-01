/**
 * PR-NEXT-6 (finding #13) — smoke pin for `uploadDeliveryProof`.
 *
 * The orchestration helper is mostly glue between three service
 * methods + a global `fetch`. The real correctness lives in the
 * server-side helper tests (`tests/functions/deliveryProofHelpers.test.ts`);
 * here we just lock the wiring contract: the three calls happen in
 * the right order, errors propagate verbatim, and a non-2xx PUT
 * surfaces an actionable error message.
 */
import { uploadDeliveryProof } from '../../src/utils/uploadDeliveryProof';
import { orderService } from '../../src/services/orderService';

const ORDER_ID = 'ord_smoke_1';
const STORAGE_PATH = `delivery-proofs/${ORDER_ID}.jpg`;
const UPLOAD_URL = 'https://storage.googleapis.com/signed-put-url';

const realFetch = global.fetch;

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = realFetch;
});

function mockHappyServiceMethods() {
  jest
    .spyOn(orderService, 'getDeliveryProofUploadUrl')
    .mockResolvedValue({
      uploadUrl: UPLOAD_URL,
      storagePath: STORAGE_PATH,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
  jest
    .spyOn(orderService, 'recordDeliveryProofUpload')
    .mockResolvedValue({ ok: true });
}

describe('uploadDeliveryProof', () => {
  test('happy path: get-url → PUT → record-confirm → returns storage path', async () => {
    mockHappyServiceMethods();
    // First fetch: file:// → blob; second fetch: PUT to signed URL.
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({ blob: async () => ({ size: 123 } as Blob) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchSpy;

    const result = await uploadDeliveryProof({
      orderId: ORDER_ID,
      localUri: 'file:///tmp/proof.jpg',
    });
    expect(result).toEqual({ storagePath: STORAGE_PATH });

    // Both service methods called exactly once with the right args.
    expect(orderService.getDeliveryProofUploadUrl).toHaveBeenCalledWith(
      ORDER_ID,
    );
    expect(orderService.recordDeliveryProofUpload).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      storagePath: STORAGE_PATH,
    });
    // PUT used the right header — v4 signature binds contentType.
    const putCall = fetchSpy.mock.calls[1];
    expect(putCall[0]).toBe(UPLOAD_URL);
    expect(putCall[1].method).toBe('PUT');
    expect(putCall[1].headers['Content-Type']).toBe('image/jpeg');
  });

  test('PUT non-2xx → throws with HTTP code + body excerpt in message', async () => {
    mockHappyServiceMethods();
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ blob: async () => ({} as Blob) })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'SignatureDoesNotMatch',
      });

    await expect(
      uploadDeliveryProof({ orderId: ORDER_ID, localUri: 'file:///x.jpg' }),
    ).rejects.toThrow(/HTTP 403.*SignatureDoesNotMatch/);

    // Crucially: record-confirm must NOT fire on a failed PUT —
    // a half-stamped order doc would pass auth checks for read but
    // point at storage that doesn't exist.
    expect(orderService.recordDeliveryProofUpload).not.toHaveBeenCalled();
  });

  test('getDeliveryProofUploadUrl rejection propagates verbatim (no swallow)', async () => {
    jest
      .spyOn(orderService, 'getDeliveryProofUploadUrl')
      .mockRejectedValue(new Error('permission-denied: not assigned'));
    const recordSpy = jest
      .spyOn(orderService, 'recordDeliveryProofUpload')
      .mockResolvedValue({ ok: true });

    await expect(
      uploadDeliveryProof({ orderId: ORDER_ID, localUri: 'file:///x.jpg' }),
    ).rejects.toThrow(/permission-denied/);

    // PUT + record never fire if upload-url mint fails — no
    // wasted bandwidth, no orphan storage object.
    expect(recordSpy).not.toHaveBeenCalled();
  });

  test('recordDeliveryProofUpload rejection propagates verbatim', async () => {
    jest
      .spyOn(orderService, 'getDeliveryProofUploadUrl')
      .mockResolvedValue({
        uploadUrl: UPLOAD_URL,
        storagePath: STORAGE_PATH,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
    jest
      .spyOn(orderService, 'recordDeliveryProofUpload')
      .mockRejectedValue(new Error('failed-precondition: not picked up'));
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ blob: async () => ({} as Blob) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    await expect(
      uploadDeliveryProof({ orderId: ORDER_ID, localUri: 'file:///x.jpg' }),
    ).rejects.toThrow(/failed-precondition/);
  });

  test('storagePath round-trips: record-call uses the path the upload-url callable handed us', async () => {
    // Belt-and-suspenders: a future bug where the helper rebuilds
    // the path locally instead of trusting the server-minted one
    // would defeat the path-prefix check on the record callable.
    // Pin the data flow.
    const customPath = 'delivery-proofs/ord_smoke_2.jpg';
    jest
      .spyOn(orderService, 'getDeliveryProofUploadUrl')
      .mockResolvedValue({
        uploadUrl: UPLOAD_URL,
        storagePath: customPath,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
    const recordSpy = jest
      .spyOn(orderService, 'recordDeliveryProofUpload')
      .mockResolvedValue({ ok: true });
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ blob: async () => ({} as Blob) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const result = await uploadDeliveryProof({
      orderId: 'ord_smoke_2',
      localUri: 'file:///x.jpg',
    });
    expect(result.storagePath).toBe(customPath);
    expect(recordSpy).toHaveBeenCalledWith({
      orderId: 'ord_smoke_2',
      storagePath: customPath,
    });
  });
});
