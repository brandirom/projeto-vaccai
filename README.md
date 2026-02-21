# Projeto Vaccai

**Teste Agora (Live Demo):** [Acesse o Projeto Vaccai online](https://brandirom.github.io/projeto-vaccai)

## O que é o Projeto Vaccai?
O Projeto Vaccai nasceu para ajudar quem está aprendendo a cantar. Muitas vezes, quem está começando tem dificuldade de saber se está acertando a nota ou não. 

O projeto funciona como um "espelho vocal": ele fornece métricas visuais claras e instantâneas no seu navegador. Com ele, você consegue ver exatamente se está no tom, identificar onde está desafinando e visualizar a estabilidade da sua voz. É uma ferramenta de *biofeedback* criada para te dar autonomia no estudo do canto.

## Privacidade
Todo o processamento da sua voz ocorre localmente, apenas na memória do seu próprio navegador (Client-Side). Nenhuma gravação, voz ou dado é enviado para a internet, nuvem ou qualquer servidor. O que você canta fica apenas com você.

## Arquitetura e Engenharia
Para que o gráfico acompanhe a sua voz em tempo real e sem nenhum atraso (latência zero), o JavaScript comum não seria rápido o suficiente. 

Por isso, todo o motor matemático de processamento de áudio do projeto foi escrito em **C++** e compilado para a web utilizando WebAssembly. Isso garante que a detecção de notas e a análise de afinação rodem com a velocidade e eficiência de um programa nativo direto na sua aba de navegação.

## Documentação Técnica
Para desenvolvedores e engenheiros interessados na matemática por trás do processador de áudio , acesse o *Whitepaper* Técnico oficial:
**[Ler a Documentação Técnica (PDF)](docs/vaccai_technical_documentation.pdf)**

## Como rodar localmente
O site já está hospedado e pronto para uso no link lá do topo, mas se você quiser baixar o projeto para modificar o código e testar no seu próprio computador, siga os passos:

**1. Clone o repositório:**
```bash
git clone https://github.com/brandirom/projeto-vaccai.git
cd projeto-vaccai

```

**2. Inicie o servidor local:**
Na raiz do projeto, execute o script Python incluso para iniciar o ambiente:

```bash
python server/server.py

```

**3. Acesse no navegador:**
Abra `http://localhost:8080/`.