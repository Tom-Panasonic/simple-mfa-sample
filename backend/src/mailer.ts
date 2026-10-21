import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { POLICY } from './policy';

export interface Mailer {
  sendCode(to: string, code: string): Promise<void>;
}

export class SesMailer implements Mailer {
  constructor(
    private readonly client: SESv2Client,
    private readonly from: string,
  ) {}

  async sendCode(to: string, code: string): Promise<void> {
    const minutes = POLICY.codeTtlMs / 60000;
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: '【MFAサンプル】認証コードのお知らせ', Charset: 'UTF-8' },
            Body: {
              Text: {
                Data: [
                  `認証コード: ${code}`,
                  '',
                  `有効期限は${minutes}分です。ログイン画面に入力してください。`,
                  'このメールに心当たりがない場合は、破棄してください。',
                ].join('\n'),
                Charset: 'UTF-8',
              },
            },
          },
        },
      }),
    );
  }
}
