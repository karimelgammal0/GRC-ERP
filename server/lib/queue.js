/** طابور طلبات الكتابة: واحد ورا التاني (إعادة التقييم بالمتوسط المرجح لازم تكون متسلسلة).
 *  لو العميل فصل وهو مستني بيتخطّى دوره من غير ما يعلّق الباقي. */
export function writeQueue() {
  let chain = Promise.resolve();
  return (req, res, next) => {
    if (req.method === 'GET') return next();
    let gone = false;
    const closed = new Promise((r) => res.on('close', () => { gone = true; r(); }));
    const prev = chain;
    chain = prev.then(() => closed);   // الدور التالي ما يبدأش قبل ما اللي قبله يخلص ويقفل
    prev.then(() => { if (!gone) next(); });
  };
}
