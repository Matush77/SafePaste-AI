// Common given names across languages, lower-cased and without diacritics.
// Used only as supporting evidence together with a following surname; a
// first name on its own is never redacted from this list.

const NAMES = `
aaron abby abdul abdullah abel abigail abraham adam adebayo adeola adrian adriana agata agnes agnieszka ahmad ahmed aida
aiden aiko aileen aisha aiyana akira akosua alan albert alberto alejandra alejandro aleksandra aleksandr alena alessandra
alessandro alex alexa alexander alexandra alexei alexis alfie alfred ali alice alicia alina alisha alison alma amal amanda
amara amber amelia amina amir amit amy ana anastasia anders andrea andreas andrei andrej andres andrew andrzej aneta angela
angelica angelo anika anita anja ann anna annabel anne anneke annette annika anthony anton antonio anya aoife arash ari ariana
arjun arnav arne arthur artur arturo asha ashley astrid aurora austin ava ayaan ayesha aylin ayumi baptiste barbara barry
bartek basia beatrice beatriz becky ben benedikt benjamin bernard bettina bianca bilal bjorn blanka bogdan boris bozena
brad brandon brenda brendan brian brianna bridget bruno bryan caitlin callum camila camille carl carla carlos carmen
carol carolina caroline cassandra catalina catherine cecilia celine cesar chantal charles charlie charlotte chen chiara
chidi chinedu chioma chloe chris christian christina christine christoph christopher claire clara claudia colin connor
cristina cynthia dalia damian dan dana daniel daniela danielle daria dario david dawid deborah declan deepak denis denise
derek diana diego dimitri dmitri dmitry dominic dominik donna dora dorota duc duncan dylan edward edwin elena eleanor elena
eli elias elif elijah elisa elisabeth eliska elizabeth ella ellen elsa emeka emil emilia emilie emily emir emma emre enrique
eric erik erika erin ethan eva evelyn ewa fabian fabio farah farid fatima fatma federica felipe felix fernando filip finn
fiona florian francesca francesco francis francisco franz freya frida gabriel gabriela gabriele gareth gary gaurav gemma
georg george georgia gerald gerard giacomo gianluca gina giorgio giovanni giulia giuseppe grace graham greta guillaume
gustav gustavo hamza hana hannah hans harriet harry haruka haruto hassan hector heidi helen helena helga henrik henry
hiroshi hugo hussein ian ibrahim ida ifeoma igor ilona imran ines ingrid irene irina isaac isabel isabella isabelle ivan
ivana iveta iwona jack jacob jacqueline jakob jakub james jamie jan jana jane janet janine jaroslav jasmine jason javier
jayden jean jennifer jens jeremy jerome jessica jiho jin joana joanna joao joe johan johanna john jonas jonathan jordan
jorge jose josef joseph josh joshua juan judith julia julian julie julien juliette jun jurgen justin kamal karim karin
karl karolina kasia katarina kate katerina katharina katherine kathleen katie katrin kayla keisha keith kelly kemal kenji
kevin khalid kim kira klara klaus kofi kristina kristof kuba kwame kyle lars laura lauren laurent lea leah leila lena
leo leon leonardo leonie liam lila lily lina linda lisa liu lorenzo louis louise luca lucas lucia lucie luis luisa lukas
lukasz luke lydia magdalena mahmoud maja malik malgorzata manuel marc marcel marcin marco marcos marcus margaret maria
mariam marie marina mario marion marek marius mark marketa markus marta martin martina mary maryam mateo mateusz mathieu
matilda matteo matthew matthias matus maurice max maxim maya megan mehmet mei melanie melissa mia michael michaela michal
michel michelle miguel mikael mikhail milan milena min miroslav mohamed mohammad mohammed monica monika morgan moritz
muhammad musa nadia nadine naomi natalia natalie natasha nathan neha nicholas nicola nicolas nicole niamh niels nikhil
nikita nikola nikolai nils nina noah noor nora nuno oleg olga oliver olivia olumide omar oscar owen pablo paolo patricia
patrick paul paula paulina pavel pawel pedro peter petra petr philip philipp pierre pieter piotr priya rachel radek
rafael rahul raj rajesh ramon rania raphael rashid ravi rebecca reza ricardo richard riley rita robert roberta roberto
robin rodrigo roman rosa ruben rui ruth ryan sabine sabrina sadia sakura salma sam samantha samir samuel sandra sanjay
sara sarah sasha scott sean sebastian selin sergei sergio seo shane shaun sheila shreya simon simona simone siobhan sofia
sofie sonia sophia sophie stanislav stefan stefano stefanie stella stephan stephanie stephen steven susan susanne sven
svetlana sylvia takeshi tamara tanja tanya tara teresa thabo theo theresa thomas tiago tim timo timothy tobias tom tomas
tomasz tomoko tony tuan ulrike valentina valeria vanessa vera veronika victor victoria viktor vincent vivian vladimir
walter wei wendy wiktoria william wojciech xavier xin yan yann yasmin yasmine yiannis yoshiko youssef yuki yuna yusuf
yuto yvonne zainab zara zeynep zhang zoe zofia zuzana
`;

/** @type {Set<string>} */
export const FIRST_NAMES = new Set(NAMES.split(/\s+/).filter(Boolean));

/**
 * Lower-cased, diacritics removed: "Tomáš" -> "tomas".
 * @param {string} word
 */
export function normaliseName(word) {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
