import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/database/mikro-orm.config';
import { hashPassword } from '../src/auth/password';
async function main() {
  const orm = await MikroORM.init(config);
  try {
    const db = orm.em.getConnection();
    const categories = [['TECH','Tech & Electronics','테크·가전'],['HOME','Home & Living','홈·리빙'],['FASHION','Fashion & Accessories','패션·잡화'],['BEAUTY','Beauty & Wellness','뷰티·웰니스'],['FOOD','Food & Beverage','푸드'],['SPORTS','Sports & Outdoors','스포츠·아웃도어'],['HOBBY','Hobbies & Entertainment','취미·엔터테인먼트'],['PETS','Pets','반려동물'],['KIDS','Baby & Kids','유아·키즈'],['MOBILITY','Mobility','모빌리티']];
    for (const [code,en,ko] of categories) await db.execute('INSERT INTO categories(code,slug,name_en,name_ko) VALUES (?,?,?,?) ON CONFLICT (code) DO NOTHING',[code,code.toLowerCase(),en,ko]);
    await db.execute("INSERT INTO categories(code,slug,name_en,name_ko,parent_id) SELECT 'HOME_APPLIANCES','home-appliances','Home Appliances','생활가전',id FROM categories WHERE code='TECH' ON CONFLICT (code) DO NOTHING");
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters');
      await db.execute("INSERT INTO users(email,password_hash,display_name,role) VALUES (?,?,'Administrator','ADMIN') ON CONFLICT DO NOTHING",[process.env.ADMIN_EMAIL.trim().toLowerCase(),hashPassword(process.env.ADMIN_PASSWORD)]);
    }
  } finally { await orm.close(); }
}
main().catch(e => {console.error(e);process.exitCode=1;});
