export const DEV_MODE = true;

export const MOCK_REFUNDS = [
  {
    subject: 'Your return has been received - ACME Store',
    snippet: 'We have received your return for Order #A12345. We will process your refund shortly.',
    status: 'pending'
  },
  {
    subject: 'Refund issued for Order #B98765',
    snippet: 'We have issued a refund of $24.99 to your original payment method.',
    status: 'refunded'
  },
  {
    subject: 'Return label created for Order #C55555',
    snippet: 'Your return label is attached. Once we receive the item we will issue a refund.',
    status: 'pending'
  }
];
