export interface BranchDef {
  title: string;
  rootId: string;
  description: string;
  surnames: string[];
}

export const branchDefs: Record<string, BranchDef> = {
  krumpos: {
    title: 'Krumpos Branch',
    rootId: 'donald-howard-krumpos',
    description: 'From Bohemia to Oconto County. The immigrant Joseph Krumpos crossed the Atlantic in 1867 and settled in Wisconsin. His grandson Donald married Dorothy Coppersmith in 1947.',
    surnames: ['Krumpos', 'Stefl', 'Kadletz', 'Schneider', 'Kosnar', 'Hrabik'],
  },
  coppersmith: {
    title: 'Coppersmith Branch',
    rootId: 'dorothy-elaine-coppersmith',
    description: 'Belgian settlers from Melin in Walloon Brabant and French-Canadian river families from the Richelieu Valley. Dorothy Elaine Coppersmith was widowed at 35 and raised seven children with quiet resilience.',
    surnames: ['Coppersmith', 'Bodoh', 'Hinson', 'Kolancheck', 'Siudzinski'],
  },
  martin: {
    title: 'Martin Branch',
    rootId: 'helen-m-martin',
    description: "Irish famine immigrants became Door County pioneers. Henry Martin arrived from County Down around 1853 and helped build Sevastopol from nothing. His youngest son Life lived to 87. Life's granddaughter Helen married Clifford Schmidt.",
    surnames: ['Martin', 'Hutchinson', 'Laing', 'Miller', 'Mielke', 'Pfister', 'Guernsey', 'Hugunin', 'Lambert'],
  },
  schmidt: {
    title: 'Schmidt Branch',
    rootId: 'clifford-alfred-schmidt',
    description: 'Germany, England, and Scotland converging in Minnesota. Clifford Alfred Schmidt married Helen Martin and brought together the Mecklenburg Schmidts, the Kent Kendalls, the Hanover Vollmers, and the Baden Kurtzes.',
    surnames: ['Schmidt', 'Rabe', 'Vollmer', 'Kurtz', 'Kendall', 'Shaffstall', 'Schindler', 'Lambert'],
  },
};
